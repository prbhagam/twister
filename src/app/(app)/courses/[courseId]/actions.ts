'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { parseRoster } from '@/lib/roster'
import { audit } from '@/lib/audit'
import { requireCoursePermission } from '@/lib/authorization'
import { fetchCanvasCourseUsers, fetchCanvasRoster, fetchCanvasUserProfile } from '@/lib/canvas'
import { reconcileDroppedStudents } from '@/lib/roster-sync'
import { normalizeSections, splitName } from '@/lib/roster'

export interface RosterImportState {
  ok?: boolean
  imported?: number
  excluded?: { role: string; count: number }[]
  sections?: { code: string; label: string; count: number }[]
  /** Students dropped from / restored to the roster by reconciling this import. */
  dropped?: number
  restored?: number
  errors?: string[]
}

export async function importCanvasRoster(
  _prev: RosterImportState,
  formData: FormData,
): Promise<RosterImportState> {
  const courseId = String(formData.get('courseId'))
  const canvasCourseId = String(formData.get('canvasCourseId') ?? '').trim()
  const user = await requireCoursePermission(courseId, 'course:manage')
  if (!/^\d+$/.test(canvasCourseId)) return { errors: ['Enter the numeric Canvas course ID.'] }

  let enrollments
  try {
    enrollments = await fetchCanvasRoster(canvasCourseId)
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : 'Could not download the Canvas roster.'] }
  }

  // Enrollments carry the section, but never the login/email, so pair them with
  // the course users list — the only identity source a teacher token can read for
  // students other than itself.
  let directory = new Map<string, Awaited<ReturnType<typeof fetchCanvasCourseUsers>>[number]>()
  try {
    directory = new Map(
      (await fetchCanvasCourseUsers(canvasCourseId))
        .filter((user) => user.id != null)
        .map((user) => [String(user.id), user]),
    )
  } catch { /* fall back to the per-user profile lookup below */ }

  // Keyed by GT ID because a student enrolled in two sections has two enrollment
  // rows: they are one student whose section list is the union of the two.
  const byGtId = new Map<string, { canvasUserId: string; gtId: string; username: string; email: string; firstName: string; lastName: string; sections: string[]; role: string }>()
  let incomplete = 0
  for (const enrollment of enrollments) {
    const canvasUserId = String(enrollment.user?.id ?? enrollment.user_id ?? '').trim()
    if (!canvasUserId) { incomplete++; continue }
    let identity = { ...enrollment.user, ...directory.get(canvasUserId) }
    if (!identity.sis_user_id || !(identity.login_id || identity.email || identity.primary_email) || !identity.name) {
      try { identity = { ...identity, ...await fetchCanvasUserProfile(canvasUserId) } }
      catch { /* keep whatever the roster and directory already provided */ }
    }
    const gtId = String(identity.sis_user_id ?? '').trim()
    const loginId = String(identity.login_id ?? identity.email ?? identity.primary_email ?? '').trim()
    const name = String(identity.name ?? identity.sortable_name ?? '').trim()
    if (!gtId || !loginId || !name) { incomplete++; continue }
    const parsedName = splitName(identity.sortable_name ?? name)
    const sections = enrollment.course_section_id ? normalizeSections(String(enrollment.course_section_id)) : []
    const existing = byGtId.get(gtId)
    if (existing) {
      for (const section of sections) if (!existing.sections.includes(section)) existing.sections.push(section)
      continue
    }
    byGtId.set(gtId, {
      canvasUserId, gtId, username: loginId.includes('@') ? loginId.split('@')[0] : loginId,
      email: loginId.includes('@') ? loginId : `${loginId}@gatech.edu`,
      firstName: parsedName.firstName, lastName: parsedName.lastName,
      sections,
      role: 'Student',
    })
  }
  const students = [...byGtId.values()]
  if (!students.length) return { errors: [`Canvas returned ${enrollments.length} enrollment(s), but none exposed the required GT ID and login ID. Ensure the token can read SIS/profile data for this course.`] }

  const { record, reconciliation } = await prisma.$transaction(async (tx) => {
    await tx.course.update({ where: { id: courseId }, data: { canvasCourseId } })
    const created = await tx.rosterImport.create({
      data: { courseId, filename: `canvas-course-${canvasCourseId}`, imported: students.length, uploadedById: user.id },
    })
    for (const student of students) {
      await tx.student.upsert({
        where: { courseId_gtId: { courseId, gtId: student.gtId } },
        create: { ...student, courseId, importId: created.id, sections: JSON.stringify(student.sections), droppedAt: null },
        update: { ...student, importId: created.id, sections: JSON.stringify(student.sections), droppedAt: null },
      })
    }
    return { record: created, reconciliation: await reconcileDroppedStudents(tx, courseId, students.map((s) => s.gtId)) }
  })
  const sectionCounts = new Map<string, number>()
  for (const student of students) for (const section of student.sections) sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1)
  const sections = [...sectionCounts].map(([code, count]) => ({ code, label: code, count }))
  await audit({ actorUserId: user.id, action: 'roster.canvas_imported', entityType: 'roster_import', entityId: record.id, courseId, metadata: { imported: students.length, canvasCourseId, ...reconciliation } })
  revalidatePath(`/courses/${courseId}`)
  return {
    ok: true,
    imported: students.length,
    excluded: incomplete ? [{ role: 'incomplete Canvas identity', count: incomplete }] : [],
    sections,
    ...reconciliation,
  }
}

/**
 * Imports a GT roster CSV. Students are upserted on (courseId, gtId) so a
 * re-uploaded roster updates names and sections instead of duplicating people —
 * and, critically, keeps each student's id stable so existing generated exams
 * still point at them.
 */
export async function importRoster(
  _prev: RosterImportState,
  formData: FormData,
): Promise<RosterImportState> {
  const courseId = String(formData.get('courseId'))
  const user = await requireCoursePermission(courseId, 'course:manage')
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return { errors: ['Choose a roster CSV to upload.'] }
  }

  const result = parseRoster(await file.text())
  if (result.students.length === 0) {
    return { errors: result.errors.length ? result.errors : ['No student rows found in that CSV.'] }
  }

  const record = await prisma.rosterImport.create({
    data: {
      courseId,
      filename: file.name,
      imported: result.students.length,
      skipped: result.excluded.reduce((sum, e) => sum + e.count, 0),
      skipDetail: JSON.stringify(result.excluded),
      uploadedById: user.id,
    },
  })
  await audit({ actorUserId: user.id, action: 'roster.imported', entityType: 'roster_import', entityId: record.id, courseId, metadata: { imported: result.students.length, skipped: result.excluded.reduce((sum, e) => sum + e.count, 0) } })

  for (const student of result.students) {
    // The GT roster CSV always carries a GT ID, so it stays the upsert key here;
    // the username rides along so an exam seeded on usernames also works.
    if (!student.gtId) continue
    await prisma.student.upsert({
      where: { courseId_gtId: { courseId, gtId: student.gtId } },
      create: {
        courseId,
        importId: record.id,
        gtId: student.gtId,
        username: student.username,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        sections: JSON.stringify(student.sections),
        role: student.role,
        droppedAt: null,
      },
      update: {
        importId: record.id,
        username: student.username,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        sections: JSON.stringify(student.sections),
        droppedAt: null,
      },
    })
  }
  const reconciliation = await reconcileDroppedStudents(
    prisma,
    courseId,
    result.students.map((student) => student.gtId).filter((gtId): gtId is string => Boolean(gtId)),
  )

  revalidatePath(`/courses/${courseId}`)
  return {
    ok: true,
    imported: result.students.length,
    excluded: result.excluded,
    sections: result.sections,
    errors: result.errors,
    ...reconciliation,
  }
}
