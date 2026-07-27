import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { byLastName, normalizeSections, parseRoster, sectionLabel, splitName } from './roster'

// Synthetic, committed. Reproduces every shape observed in a real GT export — the
// UTF-8 BOM, "Last, First" names, the duplicated "/i" section variants, TA and
// instructor rows, a duplicate GT ID, and a row with no GT ID.
const FIXTURE = path.join(import.meta.dirname, '__fixtures__', 'roster.csv')

// A real roster is student PII and is never committed. If you have one on disk the
// suite additionally checks against it; otherwise those checks are skipped.
const REAL_ROSTER = path.join(process.cwd(), 'assets', 'GaTech Roster.csv')

describe('normalizeSections', () => {
  it('collapses the duplicated /i variant of the same section', () => {
    expect(normalizeSections('202602/CS/1301/O1/27766/i, 202602/CS/1301/O1/27766')).toEqual([
      '202602/CS/1301/O1/27766',
    ])
  })

  it('keeps genuinely distinct sections', () => {
    expect(normalizeSections('202602/CS/1301/O1/27766, 202602/CS/1301/QH/28039')).toHaveLength(2)
  })

  it('handles an empty cell', () => {
    expect(normalizeSections('')).toEqual([])
  })
})

describe('sectionLabel', () => {
  it('extracts the spoken section name', () => {
    expect(sectionLabel('202602/CS/1301/O1/27766')).toBe('O1')
    expect(sectionLabel('202602/CS/1301R/HPR/27057')).toBe('HPR')
  })
})

describe('splitName', () => {
  it('splits GT "Last, First" format', () => {
    expect(splitName('Abbott, Nadia Jane')).toEqual({
      lastName: 'Abbott',
      firstName: 'Nadia Jane',
    })
  })

  it('falls back to "First Last" when there is no comma', () => {
    expect(splitName('Jane Doe')).toEqual({ lastName: 'Doe', firstName: 'Jane' })
  })
})

describe('parseRoster on a GT-shaped export', () => {
  const result = parseRoster(readFileSync(FIXTURE, 'utf8'))

  it('imports only the Student rows', () => {
    expect(result.students).toHaveLength(6)
    expect(result.students.map((s) => s.lastName)).toEqual([
      'Abbott',
      'Bello',
      'Marchetti',
      'Duarte',
      'Egwu',
      'Fitzgerald',
    ])
  })

  it('excludes TAs and the instructor, and reports why', () => {
    expect(result.excluded).toEqual(
      expect.arrayContaining([
        { role: 'Ta', count: 2 },
        { role: 'Teacher', count: 1 },
      ]),
    )
  })

  it('survives the UTF-8 BOM on the header row', () => {
    // A BOM left in place would make the first column "﻿Name" and drop every name.
    expect(result.students.every((s) => s.lastName.length > 0)).toBe(true)
    expect(result.students[0]).toMatchObject({
      lastName: 'Abbott',
      firstName: 'Nadia',
      gtId: '903000001',
    })
  })

  it('collapses the duplicated /i sections down to the real ones', () => {
    expect(result.sections.map((s) => s.label).sort()).toEqual(['HP', 'O1', 'QH'])
    // Abbott's "O1/10001/i, O1/10001" must count once, not twice.
    expect(result.sections.find((s) => s.label === 'O1')?.count).toBe(3)
  })

  it('keeps a student enrolled in two genuinely different sections', () => {
    expect(result.students.find((s) => s.lastName === 'Fitzgerald')?.sections).toHaveLength(2)
  })

  it('reports the duplicate and the missing GT ID without dropping good rows', () => {
    expect(result.errors).toHaveLength(2)
    expect(result.errors.some((e) => /duplicate GT ID 903000001/.test(e))).toBe(true)
    expect(result.errors.some((e) => /no GT ID/.test(e))).toBe(true)
  })

  it('gives every imported student a 9-digit GT ID and a section', () => {
    expect(result.students.every((s) => /^\d{9}$/.test(s.gtId ?? ''))).toBe(true)
    expect(result.students.every((s) => s.sections.length >= 1)).toBe(true)
  })

  it('captures the GT account as the username, from its own column', () => {
    // Not derived from the email: in the real roster 20 of 404 students have a GT
    // account that differs from their email prefix, and seeding the wrong one would
    // silently give those students the wrong paper.
    expect(result.students[0].username).toBe('nabbott3')
    expect(result.students.every((s) => s.username)).toBe(true)
  })
})

describe.skipIf(!existsSync(REAL_ROSTER))('parseRoster on the real GT export', () => {
  it('imports every student and no staff', () => {
    const result = parseRoster(readFileSync(REAL_ROSTER, 'utf8'))
    expect(result.students.length).toBeGreaterThan(0)
    expect(result.students.every((s) => s.role === 'Student')).toBe(true)
    expect(result.students.every((s) => /^\d{9}$/.test(s.gtId ?? ''))).toBe(true)
    expect(result.students.every((s) => s.username)).toBe(true)
    expect(result.students.every((s) => s.lastName && s.firstName)).toBe(true)
    expect(result.errors).toEqual([])
  })
})

describe('parseRoster error handling', () => {
  it('reports a missing required column instead of silently importing nothing', () => {
    const result = parseRoster('Name,Email\nDoe, Jane,j@gatech.edu\n')
    expect(result.errors[0]).toMatch(/missing required column/i)
    expect(result.students).toHaveLength(0)
  })

  it('skips duplicate GT IDs and says so', () => {
    const csv = [
      'Name,Email,GT ID,Role,Section(s)',
      '"Doe, Jane",j@gatech.edu,903000001,Student,A',
      '"Doe, Jane",j@gatech.edu,903000001,Student,A',
    ].join('\n')
    const result = parseRoster(csv)
    expect(result.students).toHaveLength(1)
    expect(result.errors[0]).toMatch(/duplicate GT ID 903000001/)
  })

  it('skips a student with no GT ID rather than seeding on an empty string', () => {
    const csv = ['Name,Email,GT ID,Role,Section(s)', '"Doe, Jane",j@gatech.edu,,Student,A'].join('\n')
    const result = parseRoster(csv)
    expect(result.students).toHaveLength(0)
    expect(result.errors[0]).toMatch(/no GT ID/)
  })
})

describe('byLastName', () => {
  it('sorts by last name then first, case-insensitively', () => {
    const people = [
      { lastName: 'brown', firstName: 'Zoe' },
      { lastName: 'Adams', firstName: 'Bo' },
      { lastName: 'Adams', firstName: 'Al' },
    ]
    expect(people.sort(byLastName).map((p) => `${p.lastName} ${p.firstName}`)).toEqual([
      'Adams Al',
      'Adams Bo',
      'brown Zoe',
    ])
  })
})
