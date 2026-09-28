import { describe, expect, it } from 'vitest'
import {
  answeredLayout,
  answeredTraceCode,
  blankPdfFileName,
  blankSeedIdentity,
  blankZipEntryName,
  formatBlankLabel,
  parseBlankLabel,
} from './blank-exams'
import { COVER_SHEET_FILE, INSTRUCTIONS_FILE } from './pdf/session-packet'
import type { LayoutEntry } from './seed'

describe('blank exam labels', () => {
  it('pads to two digits and grows past 99', () => {
    expect(formatBlankLabel(7)).toBe('BLANK-07')
    expect(formatBlankLabel(42)).toBe('BLANK-42')
    expect(formatBlankLabel(123)).toBe('BLANK-123')
  })

  it('reads back however a person copied it off the roster', () => {
    for (const typed of ['BLANK-07', 'blank-7', 'Blank 07', 'blank7', ' 07 ', '7', 'BLANK_07', '#7']) {
      expect(parseBlankLabel(typed), typed).toBe(7)
    }
  })

  it('round-trips every label it prints', () => {
    for (const n of [1, 9, 10, 99, 100, 1234]) expect(parseBlankLabel(formatBlankLabel(n))).toBe(n)
  })

  it('refuses anything that is not a blank number', () => {
    for (const typed of ['', 'BLANK-', 'BLANK-0', 'ABC123', '903012345x', 'B-07', '7.5']) {
      expect(parseBlankLabel(typed), typed).toBeNull()
    }
  })
})

describe('blank seeding and files', () => {
  it('seeds from an identity no GT ID or username can take', () => {
    // GT IDs are digits and usernames are alphanumeric: a colon is neither.
    expect(blankSeedIdentity(7)).toBe('blank:7')
  })

  it('files a blank in its session folder right after the two packet sheets', () => {
    const listing = ['Abbott-Nadia-903010000.pdf', blankZipEntryName(4), INSTRUCTIONS_FILE, COVER_SHEET_FILE].sort()
    expect(listing).toEqual([COVER_SHEET_FILE, INSTRUCTIONS_FILE, '02-BLANK-04.pdf', 'Abbott-Nadia-903010000.pdf'])
    expect(blankPdfFileName(4)).toBe('BLANK-04.pdf')
  })
})

describe('answeredLayout', () => {
  const entry = (correct: string): LayoutEntry => ({
    position: 1,
    runQuestionId: 'q',
    runVariationId: 'v',
    choiceOrder: ['a', 'b', 'c', 'd'],
    correctLetters: [correct],
    choiceCount: 4,
    points: 1,
  })
  const own = { layout: JSON.stringify([entry('A')]), traceCode: 'OWN111' }
  const blank = { layout: JSON.stringify([entry('C')]), traceCode: 'BLK222' }

  it("is the student's own paper when they sat their own session", () => {
    expect(answeredLayout({ ...own, blankExam: null })[0].correctLetters).toEqual(['A'])
    expect(answeredTraceCode({ ...own, blankExam: null })).toBe('OWN111')
  })

  it('is the blank they wrote on when they sat a different one', () => {
    expect(answeredLayout({ ...own, blankExam: blank })[0].correctLetters).toEqual(['C'])
    expect(answeredTraceCode({ ...own, blankExam: blank })).toBe('BLK222')
  })
})
