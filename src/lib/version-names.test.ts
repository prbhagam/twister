import { describe, expect, it } from 'vitest'
import { normalizeVersionNames, parseStoredVersionNames, versionNamesFromText } from './version-names'

describe('normalizeVersionNames', () => {
  it('trims, collapses whitespace, drops blanks, and keeps order', () => {
    expect(normalizeVersionNames(['  Version  Monica ', '', '   ', 'Version Rachel']).names).toEqual([
      'Version Monica',
      'Version Rachel',
    ])
  })

  it('keeps the first of a case-insensitive duplicate and reports the rest', () => {
    const result = normalizeVersionNames(['Version Ross', 'version ross', 'Version Joey'])
    expect(result.names).toEqual(['Version Ross', 'Version Joey'])
    expect(result.duplicates).toEqual(['version ross'])
  })
})

describe('versionNamesFromText', () => {
  it('reads one name per line, from either line ending', () => {
    expect(versionNamesFromText('Version Monica\r\nVersion Rachel\n\nVersion Phoebe\n')).toEqual([
      'Version Monica',
      'Version Rachel',
      'Version Phoebe',
    ])
  })
})

describe('parseStoredVersionNames', () => {
  it('reads the stored JSON array', () => {
    expect(parseStoredVersionNames('["Version Monica","Version Rachel"]')).toEqual(['Version Monica', 'Version Rachel'])
  })

  it('treats anything malformed as no names rather than throwing — this must never block generation', () => {
    expect(parseStoredVersionNames('')).toEqual([])
    expect(parseStoredVersionNames(null)).toEqual([])
    expect(parseStoredVersionNames('not json')).toEqual([])
    expect(parseStoredVersionNames('{"a":1}')).toEqual([])
    expect(parseStoredVersionNames('["Version Monica", 7, null]')).toEqual(['Version Monica'])
  })
})
