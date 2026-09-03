import { sectionLabel } from './roster'

/**
 * Course-level section handling.
 *
 * Sections arrive as opaque codes — "202608/CS/1301/O1/87196" from a GT roster CSV
 * or from Canvas's section name — and are displayed by their human label ("O1").
 * The code stays the stored identity: two terms can both have an "O1", and a label
 * collision would silently merge them.
 */

export interface SectionSummary {
  code: string
  label: string
  count: number
  excluded: boolean
}

/** Section lists are stored as JSON arrays on Student and Course. */
export function parseSectionCodes(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((code): code is string => typeof code === 'string') : []
  } catch {
    return []
  }
}

/**
 * Whether a student is withheld from generation.
 *
 * Excluding *any* of a student's sections excludes the student. GT cross-lists a
 * lecture section with its recitation — an HP student is enrolled in both "HP" and
 * "HP1" — so requiring *every* section to be excluded would mean ticking "HP" had
 * no effect at all, which is not what ticking it says.
 */
export function isStudentExcluded(studentSections: string[], excluded: readonly string[]): boolean {
  if (excluded.length === 0) return false
  return studentSections.some((code) => excluded.includes(code))
}

/**
 * Every section on the roster, with its live headcount and exclusion state.
 *
 * `known` seeds the list with sections pulled from Canvas so a section with no
 * enrolled students is still offered — otherwise an empty section could never be
 * excluded ahead of the add/drop deadline.
 */
export function summarizeSections(
  students: { sections: string }[],
  excluded: readonly string[],
  known: readonly string[] = [],
): SectionSummary[] {
  const counts = new Map<string, number>()
  for (const code of known) counts.set(code, 0)
  for (const student of students) {
    for (const code of parseSectionCodes(student.sections)) {
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([code, count]) => ({ code, label: sectionLabel(code), count, excluded: excluded.includes(code) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.code.localeCompare(b.code))
}

/** How many students a given exclusion set removes from generation. */
export function excludedStudentCount(
  students: { sections: string }[],
  excluded: readonly string[],
): number {
  return students.filter((s) => isStudentExcluded(parseSectionCodes(s.sections), excluded)).length
}
