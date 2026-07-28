import { rm } from 'node:fs/promises'
import { audit } from './audit'
import { prisma } from './db'
import { runDir } from './generation'

export interface PurgeSummary {
  name: string
  students: number
  exams: number
  runs: number
}

/**
 * Destroys an archived course and everything beneath it, including the generated
 * PDFs on disk.
 *
 * Separated from the server action so it is reachable without a request scope: the
 * action owns authentication and redirects, this owns the deletion. Callers must
 * have already checked permission — nothing here does.
 *
 * Refuses a course that is not archived, so a permanent delete can never be the
 * first thing that happens to live data.
 */
export async function purgeArchivedCourse(
  courseId: string,
  actorUserId: string,
): Promise<PurgeSummary | null> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { exams: { include: { runs: { select: { id: true } } } } },
  })
  if (!course || !course.archivedAt) return null

  const runIds = course.exams.flatMap((exam) => exam.runs.map((run) => run.id))
  const summary: PurgeSummary = {
    name: course.name,
    students: await prisma.student.count({ where: { courseId } }),
    exams: course.exams.length,
    runs: runIds.length,
  }

  // Audited before the delete: afterwards there is no course row to reference.
  await audit({
    actorUserId,
    action: 'course.permanently_deleted',
    entityType: 'course',
    entityId: courseId,
    courseId,
    metadata: { ...summary },
  })

  // Prisma applies the schema's cascades. Deleting the rows directly in SQLite
  // would leave orphaned students and exams behind, which is how this database
  // accumulated them once already.
  await prisma.course.delete({ where: { id: courseId } })

  await Promise.all(
    runIds.map((id) =>
      rm(runDir(id), { recursive: true, force: true }).catch((error) => {
        // The rows are already gone; leftover files are recoverable, a half-delete
        // is not. Log and carry on.
        console.error(`[twister] could not remove output for run ${id}:`, error)
      }),
    ),
  )

  return summary
}

/** Puts an archived course back. Archiving is meant to be reversible. */
export async function restoreArchivedCourse(
  courseId: string,
  actorUserId: string,
): Promise<boolean> {
  const course = await prisma.course.findUnique({ where: { id: courseId } })
  if (!course || !course.archivedAt) return false

  await prisma.course.update({
    where: { id: courseId },
    data: { archivedAt: null, archivedById: null },
  })
  await audit({
    actorUserId,
    action: 'course.restored',
    entityType: 'course',
    entityId: courseId,
    courseId,
  })
  return true
}
