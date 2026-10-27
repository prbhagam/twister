/**
 * Sorting and filtering for the run page's student list, kept apart from the
 * component so the ordering rules can be tested without rendering anything.
 */

export interface StudentTableRow {
  key: string
  status: string
  earned: number
  possible: number
  flags: number
  sections: { code: string; label: string }[]
  /** The sign-up bucket the student is in; null when the sheet has no record of them. */
  session: SessionRef | null
}

export interface SessionRef {
  key: string
  label: string
  kind: 'session' | 'exception' | 'not_signed_up'
  /** Session buckets only, for chronological order. */
  at: number | null
}

export interface RowFilter {
  section: string
  session: string
}

export type SortKey = 'name' | 'score' | 'flags'
export type Direction = 'asc' | 'desc'

/** The first click on a column sorts the way you most likely want to read it. */
export const FIRST_DIRECTION: Record<SortKey, Direction> = { name: 'asc', score: 'desc', flags: 'desc' }

/** Filter value meaning "no filter". */
export const ALL = ''

/** Session filter value for students with no sign-up record at all. */
export const NO_SIGNUP = '__none__'

/**
 * Rows arrive in last-name order, which is the name sort and the tie-break for
 * every other sort.
 *
 * A student with no scanned sheet sorts below everyone else whichever way score
 * is sorted: they have no score, and treating it as zero would place them among
 * students who sat the exam and got nothing right. Score compares percentages,
 * so a blank-exam student whose paper had a different total still ranks fairly.
 *
 * The section filter keeps a cross-listed student (a lecture and its
 * recitation) under each of their sections. Section and session filters
 * combine.
 */
export function arrangeRows<T extends StudentTableRow>(
  rows: T[],
  sort: { key: SortKey; direction: Direction },
  filter: RowFilter,
): T[] {
  const order = new Map(rows.map((row, i) => [row.key, i]))
  const byName = (a: T, b: T) => order.get(a.key)! - order.get(b.key)!
  const sign = sort.direction === 'asc' ? 1 : -1
  const percent = (row: T) => (row.possible > 0 ? row.earned / row.possible : 0)

  const filtered = rows.filter(
    (row) =>
      (filter.section === ALL || row.sections.some((s) => s.code === filter.section)) &&
      (filter.session === ALL ||
        (filter.session === NO_SIGNUP ? row.session === null : row.session?.key === filter.session)),
  )

  return filtered.slice().sort((a, b) => {
    if (sort.key === 'name') return sign * byName(a, b)
    if (sort.key === 'score') {
      const aMissing = a.status === 'not_taken'
      const bMissing = b.status === 'not_taken'
      if (aMissing !== bMissing) return aMissing ? 1 : -1
      if (!aMissing && percent(a) !== percent(b)) return sign * (percent(a) - percent(b))
    } else if (a.flags !== b.flags) {
      return sign * (a.flags - b.flags)
    }
    return byName(a, b)
  })
}

/** Every section present among the rows, with how many students each holds. */
export function sectionOptions(rows: StudentTableRow[]): { code: string; label: string; count: number }[] {
  const counts = new Map<string, { label: string; count: number }>()
  for (const row of rows) {
    for (const s of row.sections) {
      const entry = counts.get(s.code) ?? { label: s.label, count: 0 }
      entry.count++
      counts.set(s.code, entry)
    }
  }
  return [...counts.entries()]
    .map(([code, { label, count }]) => ({ code, label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

const KIND_ORDER: Record<SessionRef['kind'], number> = { session: 0, exception: 1, not_signed_up: 2 }

/**
 * Every sign-up bucket present among the rows with its headcount: sessions in
 * date order, then exceptions, then not signed up, then — only if anyone lacks
 * one — students with no sign-up record, so no one is unreachable by filter.
 */
export function sessionOptions(rows: StudentTableRow[]): { key: string; label: string; count: number }[] {
  const buckets = new Map<string, { ref: SessionRef; count: number }>()
  let unrecorded = 0
  for (const row of rows) {
    if (!row.session) {
      unrecorded++
      continue
    }
    const entry = buckets.get(row.session.key) ?? { ref: row.session, count: 0 }
    entry.count++
    buckets.set(row.session.key, entry)
  }
  if (buckets.size === 0) return []
  const options = [...buckets.values()]
    .sort(
      (a, b) =>
        KIND_ORDER[a.ref.kind] - KIND_ORDER[b.ref.kind] ||
        (a.ref.at ?? 0) - (b.ref.at ?? 0) ||
        a.ref.label.localeCompare(b.ref.label),
    )
    .map(({ ref, count }) => ({ key: ref.key, label: ref.label, count }))
  return unrecorded ? [...options, { key: NO_SIGNUP, label: 'No sign-up record', count: unrecorded }] : options
}
