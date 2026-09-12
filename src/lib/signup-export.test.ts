import { describe, expect, it } from 'vitest'
import { bucketFolderName, buildPacket, wantsPacketSheets } from './signup-export'

describe('bucketFolderName', () => {
  it('is the literal "Not signed up" for that bucket, regardless of rawLabel', () => {
    expect(bucketFolderName({ kind: 'not_signed_up', rawLabel: 'Not signed up', label: null })).toBe('Not signed up')
  })

  it('uses rawLabel for a session, with filesystem-illegal characters swapped out', () => {
    expect(bucketFolderName({ kind: 'session', rawLabel: '10/27/2026 1:35 PM (Scheller 101)', label: null })).toBe(
      '10-27-2026 1-35 PM (Scheller 101)',
    )
  })

  it('prefers the editable label for an exception, falling back to rawLabel when unset', () => {
    expect(
      bucketFolderName({
        kind: 'exception',
        rawLabel: 'Exception: all GTE students will be contacted with their exam arrangements.',
        label: 'GTE',
      }),
    ).toBe('GTE')
    expect(
      bucketFolderName({
        kind: 'exception',
        rawLabel: 'Exception: all GTE students will be contacted with their exam arrangements.',
        label: null,
      }),
    ).toBe('Exception- all GTE students will be contacted with their exam arrangements.')
  })

  it('collapses stray whitespace and trims', () => {
    expect(bucketFolderName({ kind: 'session', rawLabel: '  10/27/2026   1:35 PM (Scheller 101)  ', label: null })).toBe(
      '10-27-2026 1-35 PM (Scheller 101)',
    )
  })
})

describe('wantsPacketSheets', () => {
  it('covers the folders a TA physically carries to a room', () => {
    expect(wantsPacketSheets('session')).toBe(true)
    expect(wantsPacketSheets('exception')).toBe(true)
  })

  it('leaves the piles nobody proctors without a custody sheet', () => {
    // A cover sheet on these would be a signed statement about an exam session
    // that is not happening.
    expect(wantsPacketSheets('not_signed_up')).toBe(false)
    expect(wantsPacketSheets('anything_else')).toBe(false)
  })
})

describe('buildPacket', () => {
  const run = { examTitle: 'Exam 2', courseName: 'CS 1301' }
  const session = {
    kind: 'session',
    rawLabel: '10/27/2026 1:35 PM (Scheller 101)',
    label: null,
    sessionAt: new Date(2026, 9, 27, 13, 35),
    location: 'Scheller 101',
  }
  const student = (lastName: string, firstName: string, gtId: string | null, username: string | null = null) => ({
    lastName,
    firstName,
    gtId,
    username,
  })

  it('carries the run’s snapshotted names, not whatever the exam is called now', () => {
    const packet = buildPacket(run, session, [])
    expect(packet.examTitle).toBe('Exam 2')
    expect(packet.courseName).toBe('CS 1301')
  })

  it('sorts the roster by last name, the way the papers themselves are stacked', () => {
    const packet = buildPacket(run, session, [
      student('Zhang', 'Mei', '903000003'),
      student('Abbott', 'Nadia', '903000001'),
      student('abbott', 'Blake', '903000002'),
    ])
    expect(packet.students.map((s) => `${s.lastName} ${s.firstName}`)).toEqual([
      'abbott Blake',
      'Abbott Nadia',
      'Zhang Mei',
    ])
  })

  it('falls back to the username when a student has no GT ID', () => {
    const packet = buildPacket(run, session, [
      student('Abbott', 'Nadia', null, 'nabbott3'),
      student('Zhang', 'Mei', null, null),
    ])
    expect(packet.students.map((s) => s.identity)).toEqual(['nabbott3', null])
  })

  it('gives an exception bucket its short label and no date, time, or location', () => {
    const packet = buildPacket(
      run,
      { kind: 'exception', rawLabel: 'Exception: all GTE students will be contacted.', label: 'GTE', sessionAt: null, location: null },
      [],
    )
    expect(packet.sessionLabel).toBe('GTE')
    expect(packet.sessionAt).toBeNull()
    expect(packet.location).toBeNull()
  })

  it('falls back to an exception’s raw sentence when it has no short label yet', () => {
    const packet = buildPacket(
      run,
      { kind: 'exception', rawLabel: 'Exception: all GTE students will be contacted.', label: null, sessionAt: null, location: null },
      [],
    )
    expect(packet.sessionLabel).toBe('Exception: all GTE students will be contacted.')
  })
})
