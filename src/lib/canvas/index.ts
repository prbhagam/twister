import type { ScoreRow } from '../export'

export * from './client'
export * from './grades'
export * from './roster'

/**
 * Rows Canvas would reject, surfaced before an export or push rather than after.
 * Kept for the CSV path, which stays available whether or not Canvas is configured.
 */
export function canvasPreflight(rows: ScoreRow[]): string[] {
  const problems: string[] = []

  // Canvas matches on SIS User ID; a student with neither identifier cannot match.
  const missingId = rows.filter(
    (r) => !/^\d{9}$/.test(r.student.gtId ?? '') && !r.student.username,
  )
  if (missingId.length) {
    problems.push(
      `${missingId.length} student(s) have neither a GT ID nor a username; Canvas cannot match them.`,
    )
  }

  const notTaken = rows.filter((r) => r.status === 'not_taken')
  if (notTaken.length) {
    problems.push(
      `${notTaken.length} student(s) have no scanned sheet and are omitted rather than being given a zero.`,
    )
  }

  return problems
}
