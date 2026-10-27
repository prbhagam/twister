import { describe, expect, it } from 'vitest'
import { ALL, NO_SIGNUP, arrangeRows, sectionOptions, sessionOptions, type SessionRef, type StudentTableRow } from './student-table'

const MON: SessionRef = { key: 'mon', label: '10/26/2026 1:35 PM (IC 105)', kind: 'session', at: Date.UTC(2026, 9, 26, 17) }
const TUE: SessionRef = { key: 'tue', label: '10/27/2026 8:00 AM (Howey L3)', kind: 'session', at: Date.UTC(2026, 9, 27, 12) }
const ODS: SessionRef = { key: 'ods', label: 'ODS accommodation', kind: 'exception', at: null }
const NONE: SessionRef = { key: 'nsu', label: 'Not signed up', kind: 'not_signed_up', at: null }

function row(key: string, earned: number, options: Partial<StudentTableRow> = {}): StudentTableRow {
  return {
    key,
    status: 'graded',
    earned,
    possible: 40,
    flags: 0,
    sections: [{ code: '202608/CS/1301/A1/1', label: 'A1' }],
    session: TUE,
    ...options,
  }
}

const HP = { code: '202608/CS/1301/HP/2', label: 'HP' }
const HP1 = { code: '202608/CS/1301R/HP1/3', label: 'HP1' }

// Already in last-name order, as the page hands them over.
const rows = [
  row('abebe', 30, { flags: 1, session: MON }),
  row('bello', 38, { session: ODS }),
  row('chen', 0, { status: 'not_taken', session: NONE }),
  row('diaz', 22, { flags: 3, sections: [HP, HP1] }),
  row('evans', 38, { sections: [HP], session: null }),
]
const NO_FILTER = { section: ALL, session: ALL }
const keys = (rs: StudentTableRow[]) => rs.map((r) => r.key)

describe('arrangeRows', () => {
  it('keeps the incoming last-name order for the name sort, and reverses it', () => {
    expect(keys(arrangeRows(rows, { key: 'name', direction: 'asc' }, NO_FILTER))).toEqual(['abebe', 'bello', 'chen', 'diaz', 'evans'])
    expect(keys(arrangeRows(rows, { key: 'name', direction: 'desc' }, NO_FILTER))).toEqual(['evans', 'diaz', 'chen', 'bello', 'abebe'])
  })

  it('sorts by score with ties in name order, and absent students last either way', () => {
    expect(keys(arrangeRows(rows, { key: 'score', direction: 'desc' }, NO_FILTER))).toEqual(['bello', 'evans', 'abebe', 'diaz', 'chen'])
    expect(keys(arrangeRows(rows, { key: 'score', direction: 'asc' }, NO_FILTER))).toEqual(['diaz', 'abebe', 'bello', 'evans', 'chen'])
  })

  it('compares percentages, so a paper with a different total ranks fairly', () => {
    const mixed = [row('a', 30), row('b', 20, { possible: 25 })] // 75% vs 80%
    expect(keys(arrangeRows(mixed, { key: 'score', direction: 'desc' }, NO_FILTER))).toEqual(['b', 'a'])
  })

  it('sorts by flags, most first', () => {
    expect(keys(arrangeRows(rows, { key: 'flags', direction: 'desc' }, NO_FILTER))).toEqual(['diaz', 'abebe', 'bello', 'chen', 'evans'])
  })

  it('filters by section, keeping a cross-listed student under each of theirs', () => {
    expect(keys(arrangeRows(rows, { key: 'name', direction: 'asc' }, { section: HP.code, session: ALL }))).toEqual(['diaz', 'evans'])
    expect(keys(arrangeRows(rows, { key: 'name', direction: 'asc' }, { section: HP1.code, session: ALL }))).toEqual(['diaz'])
    expect(arrangeRows(rows, { key: 'name', direction: 'asc' }, { section: 'no-such-section', session: ALL })).toEqual([])
  })

  it('filters by session, including students with no sign-up record', () => {
    const byName = { key: 'name', direction: 'asc' } as const
    expect(keys(arrangeRows(rows, byName, { section: ALL, session: 'tue' }))).toEqual(['diaz'])
    expect(keys(arrangeRows(rows, byName, { section: ALL, session: 'nsu' }))).toEqual(['chen'])
    expect(keys(arrangeRows(rows, byName, { section: ALL, session: NO_SIGNUP }))).toEqual(['evans'])
  })

  it('combines the section and session filters', () => {
    const byName = { key: 'name', direction: 'asc' } as const
    expect(keys(arrangeRows(rows, byName, { section: HP.code, session: 'tue' }))).toEqual(['diaz'])
    expect(keys(arrangeRows(rows, byName, { section: HP.code, session: 'mon' }))).toEqual([])
  })

  it('does not reorder the array it was given', () => {
    const before = keys(rows)
    arrangeRows(rows, { key: 'score', direction: 'desc' }, NO_FILTER)
    expect(keys(rows)).toEqual(before)
  })
})

describe('sectionOptions', () => {
  it('lists each section once with its headcount, in label order', () => {
    expect(sectionOptions(rows)).toEqual([
      { code: '202608/CS/1301/A1/1', label: 'A1', count: 3 },
      { code: HP.code, label: 'HP', count: 2 },
      { code: HP1.code, label: 'HP1', count: 1 },
    ])
  })
})

describe('sessionOptions', () => {
  it('lists sessions by date, then exceptions, then not signed up, then no record', () => {
    expect(sessionOptions(rows).map((o) => `${o.key} ${o.count}`)).toEqual(['mon 1', 'tue 1', 'ods 1', 'nsu 1', `${NO_SIGNUP} 1`])
  })

  it('offers nothing when the exam has never been synced', () => {
    expect(sessionOptions(rows.map((r) => ({ ...r, session: null })))).toEqual([])
  })
})
