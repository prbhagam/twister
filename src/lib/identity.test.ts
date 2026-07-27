import { describe, expect, it } from 'vitest'
import {
  candidateKeys,
  identityValue,
  matchKeys,
  parseIdentityField,
  studentsMissingIdentity,
} from './identity'
import { buildLayout, type SeedQuestion } from './seed'

describe('parseIdentityField', () => {
  it('defaults to GT ID for anything unrecognized', () => {
    // The default must be the conservative one: an unreadable setting should not
    // silently reseed a class onto a different identifier.
    expect(parseIdentityField(undefined)).toBe('gtId')
    expect(parseIdentityField(null)).toBe('gtId')
    expect(parseIdentityField('')).toBe('gtId')
    expect(parseIdentityField('nonsense')).toBe('gtId')
    expect(parseIdentityField('gtId')).toBe('gtId')
  })

  it('recognizes username', () => {
    expect(parseIdentityField('username')).toBe('username')
  })
})

describe('identityValue', () => {
  const student = { gtId: '903000102', username: 'mbello3' }

  it('returns the field in use', () => {
    expect(identityValue(student, 'gtId')).toBe('903000102')
    expect(identityValue(student, 'username')).toBe('mbello3')
  })

  it('treats absent, empty, and whitespace-only as no identity', () => {
    expect(identityValue({ gtId: null, username: 'x' }, 'gtId')).toBeNull()
    expect(identityValue({ gtId: '', username: 'x' }, 'gtId')).toBeNull()
    expect(identityValue({ gtId: '   ', username: 'x' }, 'gtId')).toBeNull()
  })

  it('trims, so a padded cell seeds the same as a clean one', () => {
    expect(identityValue({ gtId: ' 903000102 ' }, 'gtId')).toBe('903000102')
  })
})

describe('studentsMissingIdentity', () => {
  const students = [
    { gtId: '903000102', username: 'mbello3' },
    { gtId: null, username: 'nosis3' },
    { gtId: '903000103', username: null },
  ]

  it('finds students who cannot be seeded under each identity', () => {
    expect(studentsMissingIdentity(students, 'gtId')).toEqual([{ gtId: null, username: 'nosis3' }])
    expect(studentsMissingIdentity(students, 'username')).toEqual([
      { gtId: '903000103', username: null },
    ])
  })

  it('is empty when everyone has the identity in use', () => {
    expect(studentsMissingIdentity([students[0]], 'gtId')).toEqual([])
  })
})

describe('seeding on different identities', () => {
  const questions: SeedQuestion[] = Array.from({ length: 12 }, (_, i) => ({
    key: `q${i + 1}`,
    refId: `run-q${i + 1}`,
    points: 1,
    variations: Array.from({ length: 3 }, (_, v) => ({
      refId: `v${i}-${v}`,
      choices: Array.from({ length: 5 }, (_, c) => ({
        refId: `c${i}-${v}-${c}`,
        isCorrect: c === 0,
        pinToLast: false,
      })),
    })),
  }))

  const layoutFor = (identity: string) =>
    buildLayout({ instructorSeed: 'seed', examId: 'exam', gtId: identity, questions })

  it('produces a completely different paper per identity — so it must never be switched after printing', () => {
    const byGtId = layoutFor('903000102')
    const byUsername = layoutFor('mbello3')
    expect(byGtId.entries).not.toEqual(byUsername.entries)
    expect(byGtId.traceCode).not.toBe(byUsername.traceCode)
  })

  it('is still deterministic under either identity', () => {
    expect(layoutFor('mbello3')).toEqual(layoutFor('mbello3'))
  })

  it('gives distinct papers to distinct usernames', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      seen.add(JSON.stringify(layoutFor(`student${i}`).entries))
    }
    expect(seen.size).toBe(200)
  })
})

describe('matchKeys', () => {
  it('indexes every identifier a student might be known by', () => {
    const keys = matchKeys({
      gtId: '903000102',
      username: 'mbello3',
      email: 'mbello3@gatech.edu',
    })
    expect(keys).toEqual(
      expect.arrayContaining(['903000102', 'mbello3', 'mbello3@gatech.edu']),
    )
  })

  it('tolerates a zero-padded GT ID', () => {
    expect(matchKeys({ gtId: '0903000104' })).toContain('903000104')
  })

  it('lowercases so case differences do not miss', () => {
    expect(matchKeys({ username: 'MBello3' })).toContain('mbello3')
  })

  it('handles a student with only one identifier', () => {
    expect(matchKeys({ username: 'nosis3' })).toEqual(['nosis3'])
    expect(matchKeys({})).toEqual([])
  })
})

describe('candidateKeys', () => {
  it('does NOT strip non-digits from a username', () => {
    // The old GT-ID-only logic stripped non-digits, which would reduce
    // "mbello3" to "3" and collide most of the roster onto one student.
    expect(candidateKeys('mbello3')).toContain('mbello3')
    expect(candidateKeys('mbello3')).not.toContain('3')
  })

  it('unpads a numeric id', () => {
    expect(candidateKeys('0903000104')).toEqual(expect.arrayContaining(['903000104']))
  })

  it('offers the local part of an email', () => {
    expect(candidateKeys('mbello3@gatech.edu')).toEqual(
      expect.arrayContaining(['mbello3@gatech.edu', 'mbello3']),
    )
  })

  it('is empty for blank input', () => {
    expect(candidateKeys('')).toEqual([])
    expect(candidateKeys('   ')).toEqual([])
  })
})
