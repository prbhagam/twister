import type { CanvasSection, CanvasUser } from './client'
import type { ParsedStudent } from '../roster'
import { splitName } from '../roster'

export interface CanvasRosterResult {
  students: ParsedStudent[]
  /** How many imported students carry each identifier — drives the exam's choice. */
  withGtId: number
  withUsername: number
  sections: { code: string; label: string; count: number }[]
  /** Rows Canvas returned that could not be used. Never silently dropped. */
  rejected: { name: string; canvasId: number; reason: string }[]
  errors: string[]
}

const GT_ID = /^\d{9}$/

/**
 * Converts a Canvas roster into the same shape the CSV importer produces.
 *
 * Stores whatever identifiers Canvas returns — `sis_user_id` (the GT ID, visible
 * only when the token's role may read SIS data) and `login_id` (the GT username,
 * usually visible without it) — and rejects only a student who has neither.
 *
 * Canvas's own internal user id is never used as a fallback. Exams are seeded from
 * the identifier, so substituting it would hand a student a different paper than
 * the CSV path produces, and a regeneration after a lost printout would not match
 * the sheet they already filled in.
 *
 * Whether the exam can actually be generated is decided later, by
 * studentsMissingIdentity() against the exam's chosen identity.
 */
export function fromCanvasRoster(
  users: CanvasUser[],
  sections: CanvasSection[],
): CanvasRosterResult {
  const sectionNames = new Map(sections.map((s) => [s.id, s.name]))
  const students: ParsedStudent[] = []
  const rejected: CanvasRosterResult['rejected'] = []
  const errors: string[] = []
  const sectionCounts = new Map<string, number>()
  const seen = new Set<string>()

  for (const user of users) {
    const sisId = (user.sis_user_id ?? '').trim()
    const username = (user.login_id ?? '').trim()
    const gtId = GT_ID.test(sisId) ? sisId : null

    // Import is deliberately permissive: store whatever identifiers Canvas gives
    // and reject only a student with none at all. Which identifier an exam is
    // actually seeded from is an exam-level decision, enforced before generation
    // by studentsMissingIdentity() — checking it here would block the import on a
    // question the roster step has no business asking.
    if (!gtId && !username) {
      rejected.push({
        name: user.name,
        canvasId: user.id,
        reason: sisId
          ? `Canvas returned SIS ID "${sisId}", which is not a 9-digit GT ID, and no login ID.`
          : 'Canvas returned neither an SIS ID (GT ID) nor a login ID (GT username) for this student.',
      })
      continue
    }

    // Dedupe on whichever identifier is present; both are unique per course.
    const identity = gtId ?? username
    if (seen.has(identity)) {
      errors.push(`Canvas returned ${identity} ("${user.name}") more than once; kept the first.`)
      continue
    }
    seen.add(identity)

    // Canvas gives "Last, First" in sortable_name and "First Last" in name.
    const { firstName, lastName } = user.sortable_name?.includes(',')
      ? splitName(user.sortable_name)
      : splitName(user.name)

    const codes = [
      ...new Set(
        (user.enrollments ?? [])
          .filter((e) => e.type === 'StudentEnrollment')
          .map((e) => sectionNames.get(e.course_section_id))
          .filter((name): name is string => Boolean(name)),
      ),
    ].sort()
    for (const code of codes) sectionCounts.set(code, (sectionCounts.get(code) ?? 0) + 1)

    students.push({
      // Both are kept when available, whichever one ends up doing the seeding.
      gtId,
      username: username || null,
      firstName,
      lastName,
      // login_id is the GT account; the address is derivable but never invented
      // beyond what Canvas actually returned.
      email: (user.email ?? (username ? `${username}@gatech.edu` : '')).trim(),
      sections: codes,
      role: 'Student',
    })
  }

  const withGtId = students.filter((s) => s.gtId).length
  const withUsername = students.filter((s) => s.username).length

  if (students.length === 0) {
    errors.push(
      users.length === 0
        ? 'Canvas returned no active students for this course.'
        : 'Canvas returned no usable identifier for any student — neither an SIS ID (GT ID) nor a ' +
          'login ID (GT username). Ask a Canvas admin to grant the token SIS read access, or import ' +
          'the roster by CSV instead.',
    )
  } else if (withGtId === 0) {
    // The common case: SIS access is withheld but login IDs come through. Say so
    // plainly, because it decides which identifier the exam must be seeded on.
    errors.push(
      `Canvas returned no GT IDs (the token lacks SIS read access), but did return usernames for ` +
        `${withUsername} of ${students.length} students. This roster can only be used by an exam set ` +
        `to seed on "GT username" — set that on the exam page before generating.`,
    )
  } else if (withGtId < students.length) {
    errors.push(
      `${students.length - withGtId} student(s) have no GT ID. An exam seeded on GT ID will refuse ` +
        `to generate until that is resolved; one seeded on usernames is unaffected.`,
    )
  }

  return {
    students,
    withGtId,
    withUsername,
    sections: [...sectionCounts]
      .map(([code, count]) => ({ code, label: code, count }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    rejected,
    errors,
  }
}

export interface RosterDiff {
  added: ParsedStudent[]
  /** In TWISTER but no longer enrolled in Canvas — usually a drop. */
  removed: { gtId: string; firstName: string; lastName: string }[]
  changed: { gtId: string; field: string; from: string; to: string }[]
  unchanged: number
}

/**
 * Compares a Canvas pull against what is already stored, so a sync shows what it
 * will do before it does it. Drops matter: a student who withdrew should not get a
 * printed exam, but one who already sat an exam must not be deleted either.
 */
type Identifiable = {
  gtId?: string | null
  username?: string | null
  email?: string | null
}

/** Every identifier a row can be recognised by, lowercased. */
function keysOf(s: Identifiable): string[] {
  return [s.gtId, s.username, s.email]
    .map((v) => v?.trim().toLowerCase())
    .filter((v): v is string => Boolean(v))
}

export function diffRoster(
  existing: {
    gtId?: string | null
    username?: string | null
    firstName: string
    lastName: string
    email: string
    sections: string[]
  }[],
  incoming: ParsedStudent[],
): RosterDiff {
  // Matched on *any* shared identifier rather than one designated field: a roster
  // imported from CSV carries GT IDs while a Canvas pull may carry only usernames,
  // and keying on one of them would report the entire class as added and dropped.
  const index = new Map<string, (typeof existing)[number]>()
  for (const s of existing) for (const k of keysOf(s)) if (!index.has(k)) index.set(k, s)

  const find = (s: Identifiable) => keysOf(s).map((k) => index.get(k)).find(Boolean)
  const matchedExisting = new Set<(typeof existing)[number]>()

  const added: ParsedStudent[] = []
  const changed: RosterDiff['changed'] = []
  let unchanged = 0

  const label = (s: Identifiable) => s.gtId ?? s.username ?? s.email ?? ''

  for (const student of incoming) {
    const previous = find(student)
    if (!previous) {
      added.push(student)
      continue
    }
    matchedExisting.add(previous)

    const fields: [string, string, string][] = [
      ['first name', previous.firstName, student.firstName],
      ['last name', previous.lastName, student.lastName],
      ['email', previous.email, student.email],
      ['sections', previous.sections.join(' '), student.sections.join(' ')],
    ]
    const diffs = fields.filter(([, from, to]) => from !== to)

    if (diffs.length === 0) unchanged++
    else for (const [field, from, to] of diffs) changed.push({ gtId: label(student), field, from, to })
  }

  const removed = existing
    .filter((s) => !matchedExisting.has(s))
    .map((s) => ({ gtId: label(s), firstName: s.firstName, lastName: s.lastName }))

  return { added, removed, changed, unchanged }
}
