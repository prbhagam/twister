'use server'

import { revalidatePath } from 'next/cache'
import { CanvasClient, diffRoster, fromCanvasRoster } from '@/lib/canvas'
import { prisma } from '@/lib/db'

/**
 * Canvas roster sync.
 *
 * Everything here runs server-side: the Canvas token is read from environment and
 * never crosses into a client component or a response body.
 */

export interface CanvasSyncState {
  ok?: boolean
  error?: string
  /** Serialized so the confirm step re-fetches nothing and can't drift. */
  canvasCourseId?: string
  added?: { gtId: string; name: string; sections: string[] }[]
  removed?: { gtId: string; name: string }[]
  changed?: { gtId: string; field: string; from: string; to: string }[]
  unchanged?: number
  rejected?: { name: string; reason: string }[]
  warnings?: string[]
  applied?: { added: number; updated: number; kept: number }
}

async function pullRoster(canvasCourseId: string) {
  const client = CanvasClient.fromEnv()
  if (!client) throw new Error('Canvas is not configured. Set CANVAS_BASE_URL and CANVAS_TOKEN.')

  const [users, sections] = await Promise.all([
    client.listStudents(canvasCourseId),
    client.listSections(canvasCourseId),
  ])
  return fromCanvasRoster(users, sections)
}

export async function previewCanvasSync(
  _prev: CanvasSyncState,
  formData: FormData,
): Promise<CanvasSyncState> {
  const courseId = String(formData.get('courseId'))
  const canvasCourseId = String(formData.get('canvasCourseId') ?? '').trim()
  if (!canvasCourseId) return { error: 'Choose a Canvas course first.' }

  let pulled: Awaited<ReturnType<typeof pullRoster>>
  try {
    pulled = await pullRoster(canvasCourseId)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  if (pulled.errors.length && pulled.students.length === 0) {
    return { error: pulled.errors.join(' '), rejected: pulled.rejected.slice(0, 20) }
  }

  const existing = await prisma.student.findMany({ where: { courseId } })
  const diff = diffRoster(
    existing.map((s) => ({
      gtId: s.gtId,
      username: s.username,
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email,
      sections: JSON.parse(s.sections) as string[],
    })),
    pulled.students,
  )

  return {
    ok: true,
    canvasCourseId,
    added: diff.added.map((s) => ({
      gtId: s.gtId ?? s.username ?? '',
      name: `${s.lastName}, ${s.firstName}`,
      sections: s.sections,
    })),
    removed: diff.removed.map((s) => ({ gtId: s.gtId, name: `${s.lastName}, ${s.firstName}` })),
    changed: diff.changed,
    unchanged: diff.unchanged,
    rejected: pulled.rejected.map((r) => ({ name: r.name, reason: r.reason })),
    warnings: pulled.errors,
  }
}

export async function commitCanvasSync(
  _prev: CanvasSyncState,
  formData: FormData,
): Promise<CanvasSyncState> {
  const courseId = String(formData.get('courseId'))
  const canvasCourseId = String(formData.get('canvasCourseId') ?? '').trim()
  if (!canvasCourseId) return { error: 'Nothing to sync — run the preview again.' }

  let pulled: Awaited<ReturnType<typeof pullRoster>>
  try {
    pulled = await pullRoster(canvasCourseId)
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  if (pulled.students.length === 0) {
    return { error: pulled.errors.join(' ') || 'Canvas returned no usable students.' }
  }

  const record = await prisma.rosterImport.create({
    data: {
      courseId,
      filename: `Canvas course ${canvasCourseId}`,
      imported: pulled.students.length,
      skipped: pulled.rejected.length,
      skipDetail: JSON.stringify(pulled.rejected),
    },
  })

  const before = await prisma.student.count({ where: { courseId } })
  for (const student of pulled.students) {
    // Upserting on the identity in use keeps each student's row id stable, so exams
    // already generated for them keep pointing at the right person.
    // Prefer the GT ID as the upsert key when present, else the username. Either
    // keeps the student's row id stable, so exams already generated for them keep
    // pointing at the right person.
    const where = student.gtId
      ? { courseId_gtId: { courseId, gtId: student.gtId } }
      : student.username
        ? { courseId_username: { courseId, username: student.username } }
        : null
    if (!where) continue

    await prisma.student.upsert({
      where,
      create: {
        courseId,
        importId: record.id,
        gtId: student.gtId,
        username: student.username,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        sections: JSON.stringify(student.sections),
        role: 'Student',
      },
      update: {
        importId: record.id,
        gtId: student.gtId ?? undefined,
        username: student.username ?? undefined,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        sections: JSON.stringify(student.sections),
      },
    })
  }
  const after = await prisma.student.count({ where: { courseId } })

  // Dropped students are deliberately left in place rather than deleted: they may
  // already have a generated exam and grades attached. Sections drive who gets an
  // exam printed, so a withdrawal is handled by section selection at generation.
  await prisma.course.update({ where: { id: courseId }, data: { canvasCourseId } })

  revalidatePath(`/courses/${courseId}`)
  return {
    ok: true,
    applied: {
      added: after - before,
      updated: pulled.students.length - (after - before),
      kept: before - (pulled.students.length - (after - before)),
    },
  }
}
