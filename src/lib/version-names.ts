/**
 * Decorative version names ("Version Monica", "Version We Were on a Break")
 * printed on each student's exam cover. Purely cosmetic: they are picked per
 * student by `pickVersionName` in seed.ts, reused freely, and carry no meaning
 * for grading. Stored on the exam as a JSON array, the same way sections are.
 *
 * A name is printed exactly as written — nothing is prefixed — so a list can mix
 * "Version Rachel" with "The One Where Ross Got High".
 */

export interface NormalizedVersionNames {
  names: string[]
  /** Names dropped because an earlier entry already had the same text. */
  duplicates: string[]
}

/** Trims, collapses inner whitespace, drops blanks, and keeps the first of any
 * case-insensitive duplicates, in the order given. */
export function normalizeVersionNames(raw: readonly string[]): NormalizedVersionNames {
  const names: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const name = entry.replace(/\s+/g, ' ').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) {
      duplicates.push(name)
      continue
    }
    seen.add(key)
    names.push(name)
  }
  return { names, duplicates }
}

/** The settings form's textarea: one name per line. */
export function versionNamesFromText(text: string): string[] {
  return normalizeVersionNames(text.split(/\r?\n/)).names
}

/** Reads the stored column. Tolerates anything malformed as "no names" rather
 * than throwing, since a bad value here should never block generation. */
export function parseStoredVersionNames(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const value: unknown = JSON.parse(json)
    if (!Array.isArray(value)) return []
    return normalizeVersionNames(value.filter((v): v is string => typeof v === 'string')).names
  } catch {
    return []
  }
}
