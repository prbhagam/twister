import type { Prisma } from '@/generated/prisma/client'

export interface RosterReconciliation {
  /** Students previously on the roster who are absent from this import. */
  dropped: number
  /** Previously-dropped students who reappeared in this import. */
  restored: number
}

/**
 * Makes the stored roster match the imported one. A re-import is the authoritative
 * snapshot of who is enrolled *now*, so anyone missing from it has dropped and must
 * stop counting toward the roster — otherwise the course accumulates every student
 * who was ever enrolled and section counts drift upward all term.
 *
 * Dropped is a flag, not a delete: StudentExam cascades from Student, so removing
 * the row would erase exams a student already sat and grades already recorded. The
 * flag also makes the operation reversible — a student who re-enrols, or a roster
 * imported from the wrong course, is restored by the next correct import.
 *
 * Reconciles on gtId because both import paths key their upsert on it. Students
 * with no gtId cannot be matched against the source and are left untouched rather
 * than dropped on a technicality.
 */
export async function reconcileDroppedStudents(
  tx: Prisma.TransactionClient,
  courseId: string,
  presentGtIds: string[],
): Promise<RosterReconciliation> {
  // An empty import would mark the entire course dropped; callers reject empty
  // rosters before reaching here, but never make that an implicit contract.
  if (!presentGtIds.length) return { dropped: 0, restored: 0 }

  const restored = await tx.student.updateMany({
    where: { courseId, gtId: { in: presentGtIds }, droppedAt: { not: null } },
    data: { droppedAt: null },
  })
  const dropped = await tx.student.updateMany({
    where: { courseId, gtId: { notIn: presentGtIds }, droppedAt: null },
    data: { droppedAt: new Date() },
  })
  return { dropped: dropped.count, restored: restored.count }
}
