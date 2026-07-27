import Papa from 'papaparse'

export interface ParsedStudent {
  gtId: string | null
  /** The GT account, e.g. "mbello3". Read from the roster's own column rather
   * than derived from the email: in the sample roster 20 of 404 students have a GT
   * account that differs from their email prefix. */
  username: string | null
  firstName: string
  lastName: string
  email: string
  sections: string[]
  role: string
}

export interface RosterParseResult {
  students: ParsedStudent[]
  /** Non-Student rows (TAs, instructors), kept for the import summary. */
  excluded: { role: string; count: number }[]
  sections: { code: string; label: string; count: number }[]
  errors: string[]
}

const REQUIRED = ['Name', 'Email', 'GT ID', 'Role']

/**
 * Section codes arrive as "202602/CS/1301/O1/27766/i, 202602/CS/1301/O1/27766" —
 * the same section listed twice, once with an "/i" suffix. Drop the suffix and
 * dedupe so a student in one section shows up in exactly one section.
 */
export function normalizeSections(raw: string): string[] {
  const out = new Set<string>()
  for (const token of raw.split(',')) {
    const code = token.trim().replace(/\/i$/, '')
    if (code) out.add(code)
  }
  return [...out].sort()
}

/** "202602/CS/1301/O1/27766" -> "O1" — the part humans actually say out loud. */
export function sectionLabel(code: string): string {
  const parts = code.split('/')
  return parts.length >= 2 ? parts[parts.length - 2] : code
}

/** GT rosters format names as "Last, First Middle". */
export function splitName(name: string): { firstName: string; lastName: string } {
  const comma = name.indexOf(',')
  if (comma === -1) {
    // Fall back to "First Last" if a roster ever arrives unformatted.
    const parts = name.trim().split(/\s+/)
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) ?? name.trim() }
  }
  return {
    lastName: name.slice(0, comma).trim(),
    firstName: name.slice(comma + 1).trim(),
  }
}

export function parseRoster(csv: string): RosterParseResult {
  // The GT export carries a UTF-8 BOM, which would otherwise become part of the
  // first header name and break the "Name" lookup.
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^﻿/, '').trim(),
  })

  const errors: string[] = []
  const fields = parsed.meta.fields ?? []
  const missing = REQUIRED.filter((f) => !fields.includes(f))
  if (missing.length) {
    return {
      students: [],
      excluded: [],
      sections: [],
      errors: [`Roster is missing required column(s): ${missing.join(', ')}`],
    }
  }

  const students: ParsedStudent[] = []
  const excludedByRole = new Map<string, number>()
  const sectionCounts = new Map<string, number>()
  const seen = new Set<string>()

  parsed.data.forEach((row, i) => {
    const line = i + 2 // header is line 1
    const role = (row['Role'] ?? '').trim()
    const name = (row['Name'] ?? '').trim()
    const gtId = (row['GT ID'] ?? '').trim()

    if (!name && !gtId) return

    if (role.toLowerCase() !== 'student') {
      excludedByRole.set(role || 'Unknown', (excludedByRole.get(role || 'Unknown') ?? 0) + 1)
      return
    }
    if (!gtId) {
      errors.push(`Line ${line}: "${name}" has no GT ID and was skipped.`)
      return
    }
    if (seen.has(gtId)) {
      errors.push(`Line ${line}: duplicate GT ID ${gtId} ("${name}") — kept the first occurrence.`)
      return
    }
    seen.add(gtId)

    const sections = normalizeSections(row['Section(s)'] ?? '')
    for (const s of sections) sectionCounts.set(s, (sectionCounts.get(s) ?? 0) + 1)

    students.push({
      gtId,
      username: (row['GT Account'] ?? '').trim() || null,
      ...splitName(name),
      email: (row['Email'] ?? '').trim(),
      sections,
      role,
    })
  })

  return {
    students,
    excluded: [...excludedByRole].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count),
    sections: [...sectionCounts]
      .map(([code, count]) => ({ code, label: sectionLabel(code), count }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    errors,
  }
}

/** Sort key for every roster-ordered output (print stacks, gradebook exports). */
export function byLastName<T extends { lastName: string; firstName: string }>(a: T, b: T): number {
  return (
    a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'base' }) ||
    a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'base' })
  )
}
