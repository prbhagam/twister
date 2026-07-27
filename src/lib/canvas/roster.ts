import type { CanvasSection, CanvasUser } from './client'
import type { IdentityField } from '../identity'
import type { ParsedStudent } from '../roster'
import { splitName } from '../roster'

export interface CanvasRosterResult {
  students: ParsedStudent[]
  sections: { code: string; label: string; count: number }[]
  /** Rows Canvas returned that could not be used. Never silently dropped. */
  rejected: { name: string; canvasId: number; reason: string }[]
  errors: string[]
}

const GT_ID = /^\d{9}$/

/**
 * Converts a Canvas roster into the same shape the CSV importer produces.
 *
 * The critical rule: a student is only usable if Canvas supplies the identifier the
 * exam is actually seeded from. Substituting Canvas's internal user id would hand
 * the same student a *different paper* than the CSV path would, and a regeneration
 * after a lost printout would not match the bubble sheet they already filled in.
 *
 * Which identifier that is depends on `identityField`:
 *   - "gtId"     requires `sis_user_id`, which Canvas returns only when the token's
 *                role may read SIS identifiers;
 *   - "username" requires `login_id`, which is usually visible without SIS access.
 *
 * The other identifier is still stored when present — it costs nothing and keeps
 * grading able to match an export keyed either way.
 */
export function fromCanvasRoster(
  users: CanvasUser[],
  sections: CanvasSection[],
  identityField: IdentityField = 'gtId',
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

    // Only the identifier actually being seeded from is mandatory.
    const identity = identityField === 'username' ? username : sisId
    if (!identity) {
      rejected.push({
        name: user.name,
        canvasId: user.id,
        reason:
          identityField === 'username'
            ? 'Canvas did not return a login ID (GT username) for this student.'
            : 'Canvas did not return an SIS ID (GT ID) for this student.',
      })
      continue
    }
    if (identityField === 'gtId' && !GT_ID.test(sisId)) {
      rejected.push({
        name: user.name,
        canvasId: user.id,
        reason: `SIS ID "${sisId}" is not a 9-digit GT ID.`,
      })
      continue
    }
    if (seen.has(identity)) {
      errors.push(
        `Canvas returned ${identityField === 'username' ? 'username' : 'GT ID'} ${identity} ("${user.name}") more than once; kept the first.`,
      )
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
      // Both are kept when available, whichever one is doing the seeding.
      gtId: GT_ID.test(sisId) ? sisId : null,
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

  if (students.length === 0 && rejected.length > 0) {
    errors.push(
      identityField === 'username'
        ? 'No student had a usable GT username. The Canvas token lacks permission to read login IDs — ' +
          'ask a Canvas admin to grant it, or import the roster by CSV instead.'
        : 'No student had a usable GT ID. The Canvas token most likely lacks permission to read SIS IDs — ' +
          'ask a Canvas admin to grant it, import the roster by CSV, or switch the exam to seed on ' +
          'usernames instead. Importing without a stable identifier would produce exams that cannot ' +
          'be reproduced.',
    )
  }

  return {
    students,
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
  identityField: IdentityField = 'gtId',
): RosterDiff {
  // Compared on the identity actually in use, so a sync run under one identity
  // does not report the whole roster as added.
  const key = (s: { gtId?: string | null; username?: string | null }) =>
    (identityField === 'username' ? s.username : s.gtId) ?? ''
  const before = new Map(existing.filter((s) => key(s)).map((s) => [key(s), s]))
  const after = new Map(incoming.filter((s) => key(s)).map((s) => [key(s), s]))

  const added = incoming.filter((s) => key(s) && !before.has(key(s)))
  const removed = existing
    .filter((s) => key(s) && !after.has(key(s)))
    .map((s) => ({ gtId: key(s), firstName: s.firstName, lastName: s.lastName }))

  const changed: RosterDiff['changed'] = []
  let unchanged = 0

  for (const student of incoming) {
    const previous = before.get(key(student))
    if (!previous) continue

    const fields: [string, string, string][] = [
      ['first name', previous.firstName, student.firstName],
      ['last name', previous.lastName, student.lastName],
      ['email', previous.email, student.email],
      ['sections', previous.sections.join(' '), student.sections.join(' ')],
    ]
    const diffs = fields.filter(([, from, to]) => from !== to)

    if (diffs.length === 0) unchanged++
    else for (const [field, from, to] of diffs) changed.push({ gtId: key(student), field, from, to })
  }

  return { added, removed, changed, unchanged }
}
