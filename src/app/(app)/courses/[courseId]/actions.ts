'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { parseRoster } from '@/lib/roster'
import { audit } from '@/lib/audit'
import { requireCoursePermission } from '@/lib/authorization'
import { fetchCanvasCourseUsers, fetchCanvasRoster, fetchCanvasSections, fetchCanvasUserProfile } from '@/lib/canvas'
import { reconcileDroppedStudents } from '@/lib/roster-sync'
import { normalizeSections, sectionLabel, splitName } from '@/lib/roster'
import { parseSectionCodes } from '@/lib/sections'

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

  // Enrollments name their section only by numeric id. The sections endpoint maps
  // that id to the registrar code ("202608/CS/1301/O1/87196"), which is what the
  // roster CSV stores and what `sectionLabel` renders as "O1". Storing the bare id
  // instead would leave every section in the UI labelled with a meaningless number.
  const sectionNames = new Map<string, string>()
  try {
    for (const section of await fetchCanvasSections(canvasCourseId)) {
      if (section.id != null && section.name?.trim()) sectionNames.set(String(section.id), section.name.trim())
    }
  } catch { /* fall back to the raw section id below */ }

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
    const sectionId = enrollment.course_section_id != null ? String(enrollment.course_section_id) : ''
    const sections = sectionId ? normalizeSections(sectionNames.get(sectionId) ?? sectionId) : []
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
  const sections = [...sectionCounts].map(([code, count]) => ({ code, label: sectionLabel(code), count }))
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

export interface SectionSyncState {
  ok?: boolean
  /** Sections whose stored code was rewritten from a bare Canvas id to the registrar code. */
  relabelled?: number
  /** Students whose stored section list changed as a result. */
  studentsUpdated?: number
  found?: number
  error?: string
}

/**
 * Refreshes section names from Canvas without touching the roster.
 *
 * Rosters imported before sections were resolvable stored the bare numeric
 * `course_section_id`, which renders as "559177" instead of "O1". This rewrites
 * those codes in place — on students and on the course's exclusion list — so the
 * labels become readable without re-importing the whole roster, which would
 * otherwise be the only way to fix them.
 */
export async function syncCanvasSections(
  _prev: SectionSyncState,
  formData: FormData,
): Promise<SectionSyncState> {
  const courseId = String(formData.get('courseId'))
  const user = await requireCoursePermission(courseId, 'course:manage')
  const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } })
  const canvasCourseId = (course.canvasCourseId ?? '').trim()
  if (!/^\d+$/.test(canvasCourseId)) {
    return { error: 'This course has no Canvas course ID yet. Import the roster from Canvas first.' }
  }

  let sections
  try {
    sections = await fetchCanvasSections(canvasCourseId)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not download the Canvas section list.' }
  }

  const rename = new Map<string, string>()
  for (const section of sections) {
    const name = section.name?.trim()
    if (section.id != null && name) rename.set(String(section.id), name)
  }
  if (rename.size === 0) return { error: `Canvas returned ${sections.length} section(s), none of them named.` }

  const students = await prisma.student.findMany({ where: { courseId }, select: { id: true, sections: true } })
  let studentsUpdated = 0
  const relabelled = new Set<string>()
  for (const student of students) {
    const current = parseSectionCodes(student.sections)
    // Dedupe: a student listed under both the id and the name form of one section
    // must not end up in it twice.
    const mapped = [...new Set(current.map((code) => rename.get(code) ?? code))].sort()
    if (mapped.join(' ') === current.join(' ')) continue
    for (const code of current) if (rename.has(code)) relabelled.add(code)
    await prisma.student.update({ where: { id: student.id }, data: { sections: JSON.stringify(mapped) } })
    studentsUpdated++
  }

  // The exclusion list stores the same codes, so it has to move with them or an
  // excluded section would silently stop being excluded.
  const excluded = parseSectionCodes(course.excludedSections)
  const remapped = [...new Set(excluded.map((code) => rename.get(code) ?? code))].sort()
  if (remapped.join(' ') !== excluded.join(' ')) {
    await prisma.course.update({ where: { id: courseId }, data: { excludedSections: JSON.stringify(remapped) } })
  }

  await audit({
    actorUserId: user.id,
    action: 'course.sections_synced',
    entityType: 'course',
    entityId: courseId,
    courseId,
    metadata: { canvasCourseId, sections: rename.size, studentsUpdated },
  })
  revalidatePath(`/courses/${courseId}`)
  return { ok: true, found: rename.size, relabelled: relabelled.size, studentsUpdated }
}

/**
 * Sets the sections withheld from every exam in this course.
 *
 * Only recorded here; the filter is applied when a run is created, so changing it
 * never rewrites a run that has already been generated.
 */
export async function updateExcludedSections(formData: FormData) {
  const courseId = String(formData.get('courseId'))
  const user = await requireCoursePermission(courseId, 'course:manage')

  // Accept only codes that exist on the roster, so a stale form cannot write
  // exclusions for sections this course has never seen.
  const known = new Set<string>()
  for (const student of await prisma.student.findMany({ where: { courseId }, select: { sections: true } })) {
    for (const code of parseSectionCodes(student.sections)) known.add(code)
  }
  const excluded = [...new Set(formData.getAll('excluded').map(String).filter((code) => known.has(code)))].sort()

  await prisma.course.update({ where: { id: courseId }, data: { excludedSections: JSON.stringify(excluded) } })
  await audit({
    actorUserId: user.id,
    action: 'course.sections_excluded',
    entityType: 'course',
    entityId: courseId,
    courseId,
    metadata: { excluded },
  })
  revalidatePath(`/courses/${courseId}`)
}
