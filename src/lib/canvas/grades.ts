import type { CanvasSubmission, GradeKeyKind } from './client'
import type { ScoreRow } from '../export'
import { byLastName } from '../roster'

export interface GradeChange {
  gtId: string
  /** Which Canvas id syntax addresses this student; see GradeKeyKind. */
  keyKind: GradeKeyKind
  name: string
  score: number
  possible: number
  /** What Canvas currently holds, or null if the student has no score yet. */
  existing: number | null
}

export interface GradePushPlan {
  /** Students whose Canvas score would change (or be set for the first time). */
  changes: GradeChange[]
  /** Already match what Canvas holds — pushed anyway would be a no-op. */
  unchanged: GradeChange[]
  /** Already graded in Canvas with a *different* score. Worth a second look. */
  conflicts: GradeChange[]
  /** No scanned sheet in TWISTER; deliberately not pushed as a zero. */
  skippedNotTaken: { gtId: string; name: string }[]
  /** Cannot be matched to Canvas by GT ID. */
  skippedNoGtId: { gtId: string; name: string }[]
  totalToPush: number
}

/**
 * Builds the dry-run for a grade push.
 *
 * A push writes to real student records, so nothing goes out until this plan has
 * been shown and confirmed. Two deliberate choices:
 *  - students with no scanned sheet are *not* pushed as zeros, because "absent" and
 *    "scored zero" are different claims and only the instructor should make the
 *    second one;
 *  - a score Canvas already holds that differs from ours is surfaced separately
 *    rather than silently overwritten, since that usually means someone graded by
 *    hand in Canvas.
 */
export function planGradePush(
  rows: ScoreRow[],
  submissions: CanvasSubmission[],
  canvasUserIdByGtId: Map<string, number>,
): GradePushPlan {
  const existingByUserId = new Map(submissions.map((s) => [s.user_id, s.score]))

  const changes: GradeChange[] = []
  const unchanged: GradeChange[] = []
  const conflicts: GradeChange[] = []
  const skippedNotTaken: GradePushPlan['skippedNotTaken'] = []
  const skippedNoGtId: GradePushPlan['skippedNoGtId'] = []

  for (const row of rows.slice().sort((a, b) => byLastName(a.student, b.student))) {
    const name = `${row.student.lastName}, ${row.student.firstName}`

    if (row.status === 'not_taken') {
      skippedNotTaken.push({ gtId: row.student.gtId ?? row.student.username ?? '', name })
      continue
    }
    // Match on GT ID when present, else the username: a Canvas token without SIS
    // permission can still identify students by login id. The two are addressed by
    // different Canvas prefixes, so which one was used has to travel with the key.
    const hasGtId = /^\d{9}$/.test(row.student.gtId ?? '')
    const key = hasGtId ? row.student.gtId! : row.student.username
    const keyKind: GradeKeyKind = hasGtId ? 'sis_user_id' : 'sis_login_id'
    if (!key) {
      skippedNoGtId.push({ gtId: row.student.gtId ?? '', name })
      continue
    }

    const userId = canvasUserIdByGtId.get(key)
    const existing = userId === undefined ? null : (existingByUserId.get(userId) ?? null)
    const entry: GradeChange = {
      gtId: key,
      keyKind,
      name,
      score: row.earned,
      possible: row.possible,
      existing,
    }

    if (existing === null) changes.push(entry)
    else if (existing === row.earned) unchanged.push(entry)
    else conflicts.push(entry)
  }

  return {
    changes,
    unchanged,
    conflicts,
    skippedNotTaken,
    skippedNoGtId,
    totalToPush: changes.length + conflicts.length,
  }
}

/** The rows a confirmed push actually sends: new scores plus accepted overwrites. */
export function gradesToPush(
  plan: GradePushPlan,
): { key: string; kind: GradeKeyKind; score: number }[] {
  return [...plan.changes, ...plan.conflicts].map(({ gtId, keyKind, score }) => ({
    key: gtId,
    kind: keyKind,
    score,
  }))
}

/** Warns about anything that would make a Canvas import behave unexpectedly. */
export function gradePushWarnings(
  plan: GradePushPlan,
  assignment: { points_possible: number | null; published: boolean; post_manually?: boolean } | null,
): string[] {
  const warnings: string[] = []

  if (assignment && !assignment.published) {
    warnings.push('This Canvas assignment is unpublished. Grades can be pushed but students will not see them.')
  }

  const maxPossible = Math.max(0, ...plan.changes.concat(plan.conflicts).map((c) => c.possible))
  if (assignment?.points_possible != null && maxPossible > 0 && assignment.points_possible !== maxPossible) {
    warnings.push(
      `The exam is out of ${maxPossible} points but the Canvas assignment is out of ${assignment.points_possible}. Scores are pushed as raw points, so the percentages will not line up.`,
    )
  }

  if (plan.conflicts.length > 0) {
    warnings.push(
      `${plan.conflicts.length} student(s) already have a different score in Canvas. Pushing will overwrite them.`,
    )
  }

  if (plan.skippedNotTaken.length > 0) {
    warnings.push(
      `${plan.skippedNotTaken.length} student(s) have no scanned sheet and will be skipped rather than given a zero.`,
    )
  }

  if (plan.skippedNoGtId.length > 0) {
    warnings.push(
      `${plan.skippedNoGtId.length} student(s) have no valid GT ID and cannot be matched in Canvas.`,
    )
  }

  if (assignment?.post_manually) {
    warnings.push(
      'This assignment uses a manual posting policy, so pushed grades stay hidden until you post them in Canvas.',
    )
  }

  return warnings
}
