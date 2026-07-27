/**
 * Which student identifier drives an exam.
 *
 * One value has to serve three jobs at once, and they must agree or the system
 * quietly breaks:
 *   1. it seeds the randomization, so it must be stable per student forever;
 *   2. it is stamped into the bubble sheet's ID box, so it must be what Gradescope
 *      matches its roster on — otherwise no scanned sheet auto-matches;
 *   3. it joins the Gradescope export back to a student at grading time.
 *
 * GT ID is the safer default. Username exists because a Canvas token without SIS
 * permission cannot see GT IDs, and because some Gradescope rosters are keyed on
 * the GT account rather than the nine-digit number.
 */
export type IdentityField = 'gtId' | 'username'

export const IDENTITY_FIELDS: IdentityField[] = ['gtId', 'username']

export const IDENTITY_LABEL: Record<IdentityField, string> = {
  gtId: 'GT ID (9 digits)',
  username: 'GT username',
}

export const IDENTITY_HINT: Record<IdentityField, string> = {
  gtId: 'Stamps 903000101 into the bubble sheet ID box. Use this when Gradescope matches students on their 9-digit ID.',
  username: 'Stamps mbello3 into the bubble sheet ID box. Use this when Gradescope matches students on their GT account, or when Canvas cannot expose SIS IDs.',
}

export function parseIdentityField(value: string | null | undefined): IdentityField {
  return value === 'username' ? 'username' : 'gtId'
}

export interface IdentifiableStudent {
  gtId?: string | null
  username?: string | null
}

/** The value that seeds this student's exam and is printed on their sheet. */
export function identityValue(
  student: IdentifiableStudent,
  field: IdentityField,
): string | null {
  const value = (field === 'username' ? student.username : student.gtId)?.trim()
  return value ? value : null
}

/**
 * Students who cannot be given an exam under the chosen identity.
 *
 * Surfaced before generation rather than at print time: seeding on an empty string
 * would give every affected student the *same* paper.
 */
export function studentsMissingIdentity<T extends IdentifiableStudent>(
  students: T[],
  field: IdentityField,
): T[] {
  return students.filter((s) => identityValue(s, field) === null)
}

/**
 * Every identifier a Gradescope export might carry for this student, lowercased.
 * Grading matches on any of them, so a roster keyed one way still grades against an
 * export keyed another.
 */
export function matchKeys(student: {
  gtId?: string | null
  username?: string | null
  email?: string | null
}): string[] {
  const keys = new Set<string>()

  const gtId = student.gtId?.trim()
  if (gtId) {
    keys.add(gtId.toLowerCase())
    // Tolerate zero-padding: "0903000104" and "903000104" are the same person.
    const digits = gtId.replace(/\D/g, '').replace(/^0+/, '')
    if (digits) keys.add(digits)
  }

  const username = student.username?.trim()
  if (username) keys.add(username.toLowerCase())

  const email = student.email?.trim()
  if (email) {
    keys.add(email.toLowerCase())
    keys.add(email.split('@')[0].toLowerCase())
  }

  return [...keys]
}

/**
 * Normalizes a value from a Gradescope export into candidate lookup keys.
 *
 * Deliberately does not strip non-digits unconditionally: doing so would reduce the
 * username "mbello3" to "3" and collide half the roster.
 */
export function candidateKeys(raw: string): string[] {
  const value = raw.trim()
  if (!value) return []

  const keys = new Set<string>([value.toLowerCase()])
  if (/^\d+$/.test(value)) {
    const unpadded = value.replace(/^0+/, '')
    if (unpadded) keys.add(unpadded)
  }
  if (value.includes('@')) keys.add(value.split('@')[0].toLowerCase())

  return [...keys]
}
