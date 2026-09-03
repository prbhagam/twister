import { describe, expect, it } from 'vitest'
import {
  classifySignupSlot,
  deriveDefaultLabel,
  extractSpreadsheetId,
  matchSignupRows,
  parseSignupSheetCsv,
  parseSlotsCsv,
  type ParsedSignupRow,
} from './google-sheets'

describe('extractSpreadsheetId', () => {
  it('reads the id out of an edit URL', () => {
    expect(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1Ia0cb9nSttjzBmj5t7lZi09ukCqUY06-G4WMXkLjR3M/edit?usp=sharing')).toBe(
      '1Ia0cb9nSttjzBmj5t7lZi09ukCqUY06-G4WMXkLjR3M',
    )
  })

  it('reads the id out of a URL with a gid fragment', () => {
    expect(extractSpreadsheetId('https://docs.google.com/spreadsheets/d/1Ia0cb9nSttjzBmj5t7lZi09ukCqUY06-G4WMXkLjR3M/edit#gid=12345')).toBe(
      '1Ia0cb9nSttjzBmj5t7lZi09ukCqUY06-G4WMXkLjR3M',
    )
  })

  it('accepts a bare id typed directly', () => {
    expect(extractSpreadsheetId('1Ia0cb9nSttjzBmj5t7lZi09ukCqUY06-G4WMXkLjR3M')).toBe('1Ia0cb9nSttjzBmj5t7lZi09ukCqUY06-G4WMXkLjR3M')
  })

  it('rejects garbage', () => {
    expect(extractSpreadsheetId('not a link')).toBeNull()
    expect(extractSpreadsheetId('')).toBeNull()
  })
})

describe('classifySignupSlot', () => {
  it('recognizes "Not signed up", case- and spacing-tolerant', () => {
    expect(classifySignupSlot('Not signed up').kind).toBe('not_signed_up')
    expect(classifySignupSlot('not signed up').kind).toBe('not_signed_up')
    expect(classifySignupSlot('  Not Signed Up  ').kind).toBe('not_signed_up')
  })

  it('parses a session string into date, time, and location', () => {
    const c = classifySignupSlot('10/27/2026 1:35 PM (Scheller 101)')
    expect(c.kind).toBe('session')
    expect(c.location).toBe('Scheller 101')
    expect(c.sessionAt).toEqual(new Date(2026, 9, 27, 13, 35))
    expect(c.naturalKey).toBe('2026-10-27|13:35|scheller 101')
  })

  it('groups an exception sentence by its exact text', () => {
    const a = classifySignupSlot('Exception: all GTE students will be contacted with their exam arrangements as we get closer to exam week.')
    const b = classifySignupSlot('Exception: all GTE students will be contacted with their exam arrangements as we get closer to exam week.')
    expect(a.kind).toBe('exception')
    expect(a.naturalKey).toBe(b.naturalKey)
  })

  it('treats two different exception sentences as two different buckets', () => {
    const a = classifySignupSlot('Exception: all OMSCS Seminar students do NOT take the in-person exams.')
    const b = classifySignupSlot('Exception: all GTE students will be contacted.')
    expect(a.naturalKey).not.toBe(b.naturalKey)
  })

  it('falls back to an exception-shaped bucket for an unparseable session string, rather than dropping it', () => {
    const c = classifySignupSlot('Sometime next week, TBD')
    expect(c.kind).toBe('exception')
    expect(c.rawLabel).toBe('Sometime next week, TBD')
  })
})

describe('deriveDefaultLabel', () => {
  it('strips the Exception: prefix', () => {
    expect(deriveDefaultLabel('Exception: GTE students are exempt.')).toBe('GTE students are exempt.')
  })

  it('truncates a long sentence at a word boundary', () => {
    const label = deriveDefaultLabel(
      'Exception: all OMSCS Seminar students do NOT take the in-person exams and are therefore exempt from this sign-up assignment.',
    )
    expect(label.length).toBeLessThanOrEqual(41)
    expect(label.endsWith('…')).toBe(true)
    expect(label).not.toMatch(/\s…$/) // no stray space before the ellipsis
  })
})

describe('parseSignupSheetCsv', () => {
  const HEADER = 'GTID,FirstName,LastName,CanvasUserId,SignupSlot'

  it('parses the three real shapes from the sample sheet', () => {
    const csv = [
      HEADER,
      '904246722,Alessandra,Abanador,1930950,Not signed up',
      '903977463,Lulya,Afeworki,1379106,10/27/2026 1:35 PM (Scheller 101)',
      '900000001,Test,Student,1111111,Exception: all GTE students will be contacted with their exam arrangements as we get closer to exam week.',
    ].join('\n')
    const { rows, errors } = parseSignupSheetCsv(csv)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows[0].classified.kind).toBe('not_signed_up')
    expect(rows[1].classified.kind).toBe('session')
    expect(rows[2].classified.kind).toBe('exception')
  })

  it('is case-insensitive and tolerant of column order', () => {
    const csv = ['SignupSlot,gtid,canvasuserid,lastname,firstname', 'Not signed up,904246722,1930950,Abanador,Alessandra'].join('\n')
    const { rows, errors } = parseSignupSheetCsv(csv)
    expect(errors).toEqual([])
    expect(rows[0].gtId).toBe('904246722')
  })

  it('reports missing required columns', () => {
    const { errors } = parseSignupSheetCsv('GTID,FirstName\n1,A')
    expect(errors[0]).toMatch(/missing required column/)
  })

  it('warns, without erroring, on an unparseable session string', () => {
    const csv = [HEADER, '904246722,A,B,1,Sometime next week'].join('\n')
    const { errors, warnings } = parseSignupSheetCsv(csv)
    expect(errors).toEqual([])
    expect(warnings[0]).toMatch(/Sometime next week/)
  })
})

describe('parseSlotsCsv', () => {
  it('parses the Slots tab and normalizes to the same naturalKey a session string would use', () => {
    const csv = ['Date,Time,Room,Capacity,Filled,', '10/27/26,1:35 PM,Scheller 101,70,31,44.29%'].join('\n')
    const { slots, errors } = parseSlotsCsv(csv)
    expect(errors).toEqual([])
    expect(slots).toHaveLength(1)
    expect(slots[0].capacity).toBe(70)

    const fromMainTab = classifySignupSlot('10/27/2026 1:35 PM (Scheller 101)')
    expect(slots[0].naturalKey).toBe(fromMainTab.naturalKey)
  })

  it('reports missing Date/Time/Room columns without throwing', () => {
    const { slots, errors } = parseSlotsCsv('Foo,Bar\n1,2')
    expect(slots).toEqual([])
    expect(errors[0]).toMatch(/Date, Time, or Room/)
  })

  it('skips a row it cannot parse as a date/time rather than failing the whole tab', () => {
    const csv = ['Date,Time,Room,Capacity', 'not-a-date,not-a-time,Scheller 101,70'].join('\n')
    const { slots, errors } = parseSlotsCsv(csv)
    expect(errors).toEqual([])
    expect(slots).toEqual([])
  })
})

describe('matchSignupRows', () => {
  const roster = [
    { id: 's1', gtId: '904246722', canvasUserId: '1930950' },
    { id: 's2', gtId: null, canvasUserId: '1379106' },
  ]

  function row(gtId: string, canvasUserId: string): ParsedSignupRow {
    return {
      gtId,
      canvasUserId,
      firstName: 'Test',
      lastName: 'Student',
      rawSignupSlot: 'Not signed up',
      classified: classifySignupSlot('Not signed up'),
    }
  }

  it('matches on GTID', () => {
    const report = matchSignupRows([row('904246722', '999')], roster)
    expect(report.matched).toEqual([{ studentId: 's1', row: row('904246722', '999'), matchedOn: 'gtId' }])
  })

  it('falls back to CanvasUserId when GTID has no match (a student the roster has no GT ID for)', () => {
    const report = matchSignupRows([row('000000000', '1379106')], roster)
    expect(report.matched[0]).toMatchObject({ studentId: 's2', matchedOn: 'canvasUserId' })
  })

  it('reports a row that matches neither identifier', () => {
    const report = matchSignupRows([row('111111111', '222222')], roster)
    expect(report.matched).toEqual([])
    expect(report.unmatched).toEqual([{ gtId: '111111111', canvasUserId: '222222', name: 'Test Student', signupSlot: 'Not signed up' }])
  })
})
