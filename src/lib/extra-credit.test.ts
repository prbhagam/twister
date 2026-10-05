import { describe, expect, it } from 'vitest'
import {
  EXTRA_CREDIT_POINTS,
  SHEET_ROWS,
  formatExtraCreditLetters,
  parseExtraCreditLetters,
  readExtraCredit,
  validateExtraCredit,
} from './extra-credit'
import { checkPositionCoverage, gradeStudent, isFlagged } from './grading'
import type { LayoutEntry } from './seed'

function entry(position: number, correctLetters: string[]): LayoutEntry {
  return {
    position,
    runQuestionId: `q${position}`,
    runVariationId: `v${position}`,
    choiceOrder: ['c0', 'c1', 'c2', 'c3', 'c4'],
    correctLetters,
    choiceCount: 5,
    points: 1,
  }
}

/** A 40-question exam whose key is A everywhere, for score arithmetic. */
const layout40 = Array.from({ length: 40 }, (_, i) => entry(i + 1, ['A']))

/** Every question answered correctly. */
function allCorrect(): Map<number, string> {
  return new Map(layout40.map((e) => [e.position, 'A']))
}

const extraCredit = { position: 92, letters: ['A', 'C', 'E'] }

describe('parseExtraCreditLetters', () => {
  it('accepts the combination typed any of the ways a person types it', () => {
    for (const input of ['ACE', 'ace', 'A C E', 'A, C, E', 'a;c;e', 'A/C/E', 'A-C-E']) {
      expect(parseExtraCreditLetters(input).letters).toEqual(['A', 'C', 'E'])
    }
  })

  it('sorts and de-duplicates, because one bubble row records a set', () => {
    // Gradescope reports a row's marks in sheet order however the student filled
    // them, so "CAE" and "ACE" are the same paper and must not be two keys.
    expect(parseExtraCreditLetters('ECA').letters).toEqual(['A', 'C', 'E'])
    expect(parseExtraCreditLetters('AAC').letters).toEqual(['A', 'C'])
  })

  it('reports what it could not use rather than dropping it', () => {
    const { letters, invalid } = parseExtraCreditLetters('A X C 9')
    expect(letters).toEqual(['A', 'C'])
    expect(invalid).toEqual(['X', '9'])
  })

  it('reads an empty box as no combination', () => {
    expect(parseExtraCreditLetters('   ').letters).toEqual([])
  })
})

describe('formatExtraCreditLetters', () => {
  it('reads as a sentence, for the printed instruction', () => {
    expect(formatExtraCreditLetters(['A'])).toBe('A')
    expect(formatExtraCreditLetters(['A', 'C'])).toBe('A and C')
    expect(formatExtraCreditLetters(['A', 'C', 'E'])).toBe('A, C and E')
  })
})

describe('validateExtraCredit', () => {
  it('passes a row past the questions with a combination', () => {
    expect(validateExtraCredit({ position: 92, letters: ['A', 'C'] }, 40)).toEqual([])
  })

  it('treats a blank number as switched off', () => {
    expect(validateExtraCredit({ position: null, letters: [] }, 40)).toEqual([])
  })

  it('says so when letters are set but the number is not', () => {
    // Otherwise the instructor is left wondering why nobody got the point.
    expect(validateExtraCredit({ position: null, letters: ['A'] }, 40)).toHaveLength(1)
  })

  it('blocks a row that collides with a real question', () => {
    // Row 12 of a 40-question exam is question 12's own answer: both would grade
    // off the same bubbles and the student could not satisfy either.
    const issues = validateExtraCredit({ position: 12, letters: ['A'] }, 40)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('already uses questions 1-40')
  })

  it('blocks the boundary row, which is the last real question', () => {
    expect(validateExtraCredit({ position: 40, letters: ['A'] }, 40)).toHaveLength(1)
    expect(validateExtraCredit({ position: 41, letters: ['A'] }, 40)).toEqual([])
  })

  it('blocks a row the sheet does not have', () => {
    const issues = validateExtraCredit({ position: SHEET_ROWS + 1, letters: ['A'] }, 40)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain(`only has ${SHEET_ROWS} rows`)
  })

  it('blocks a number with no combination to bubble', () => {
    expect(validateExtraCredit({ position: 92, letters: [] }, 40)).toHaveLength(1)
  })
})

describe('readExtraCredit', () => {
  it('reads the stored columns', () => {
    expect(readExtraCredit({ extraCreditPosition: 92, extraCreditLetters: '["A","C"]' })).toEqual({
      position: 92,
      letters: ['A', 'C'],
    })
  })

  it('reads a null position as off', () => {
    expect(readExtraCredit({ extraCreditPosition: null, extraCreditLetters: '["A"]' })).toBeNull()
  })

  it('reads a position with no letters as off, not as nobody passing', () => {
    // No paper could satisfy an empty combination; scoring nobody beats marking
    // the whole class incorrect on a row the instructor never finished setting up.
    expect(readExtraCredit({ extraCreditPosition: 92, extraCreditLetters: '[]' })).toBeNull()
  })
})

describe('the bonus point in a score', () => {
  it('scores a perfect paper plus the bonus as 41 out of 40', () => {
    const result = gradeStudent({
      layout: layout40,
      responses: new Map([...allCorrect(), [92, 'A;C;E']]),
      status: 'Graded',
      extraCredit,
    })

    expect(result.earned).toBe(40 + EXTRA_CREDIT_POINTS)
    // The whole point of the feature: the denominator does not move.
    expect(result.possible).toBe(40)
  })

  it('leaves a perfect paper at 40 out of 40 when the bonus is missed', () => {
    const result = gradeStudent({
      layout: layout40,
      responses: allCorrect(),
      status: 'Graded',
      extraCredit,
    })
    expect(result.earned).toBe(40)
    expect(result.possible).toBe(40)
  })

  it('adds the bonus to a partial score without changing the total', () => {
    const responses = new Map(allCorrect())
    responses.set(1, 'B') // one question wrong
    responses.set(92, 'A;C;E')

    const result = gradeStudent({ layout: layout40, responses, status: 'Graded', extraCredit })
    expect(result.earned).toBe(40) // 39 + 1 bonus
    expect(result.possible).toBe(40)
  })

  it('ignores the bonus row entirely when the exam has none', () => {
    // A student who bubbles 92 on an exam with no extra credit gets nothing for it,
    // and no phantom row appears in their result.
    const result = gradeStudent({
      layout: layout40,
      responses: new Map([...allCorrect(), [92, 'A;C;E']]),
      status: 'Graded',
    })
    expect(result.earned).toBe(40)
    expect(result.questions).toHaveLength(40)
  })

  it('appends the bonus as the last row, after the printed questions', () => {
    const result = gradeStudent({
      layout: layout40,
      responses: new Map([...allCorrect(), [92, 'A;C;E']]),
      status: 'Graded',
      extraCredit,
    })
    const last = result.questions.at(-1)!
    expect(result.questions).toHaveLength(41)
    expect(last.extraCredit).toBe(true)
    expect(last.position).toBe(92)
    // Worth 1 if correct — which is what an override recompute reads back — even
    // though it is absent from `possible`.
    expect(last.possible).toBe(EXTRA_CREDIT_POINTS)
    expect(last.awarded).toBe(EXTRA_CREDIT_POINTS)
  })

  it('carries no bonus row for a student with no scanned sheet', () => {
    const result = gradeStudent({
      layout: layout40,
      responses: new Map(),
      status: 'Missing',
      extraCredit,
    })
    expect(result.status).toBe('not_taken')
    expect(result.questions).toEqual([])
    expect(result.possible).toBe(40)
  })
})

describe('what counts as bubbling the combination', () => {
  const grade = (raw: string) =>
    gradeStudent({
      layout: layout40,
      responses: new Map([[92, raw]]),
      status: 'Graded',
      extraCredit,
    }).questions.at(-1)!

  it('does not care what order the bubbles were filled in', () => {
    for (const raw of ['A;C;E', 'E;C;A', 'C;A;E', 'ace']) {
      expect(grade(raw).verdict).toBe('correct')
    }
  })

  it('wants the whole combination: a subset earns nothing', () => {
    expect(grade('A;C').verdict).toBe('incorrect')
    expect(grade('A').verdict).toBe('incorrect')
  })

  it('wants nothing extra either', () => {
    expect(grade('A;C;E;B').verdict).toBe('incorrect')
  })

  it('reads an unmarked row as blank, and awards nothing', () => {
    expect(grade('').verdict).toBe('blank')
    expect(grade('--').verdict).toBe('blank')
    expect(grade('').awarded).toBe(0)
  })

  it('treats a second mark on a single-letter combination as multi', () => {
    const single = gradeStudent({
      layout: layout40,
      responses: new Map([[92, 'A;B']]),
      status: 'Graded',
      extraCredit: { position: 92, letters: ['A'] },
    }).questions.at(-1)!
    expect(single.verdict).toBe('multi')
    expect(single.awarded).toBe(0)
  })
})

describe('flagging', () => {
  it('never flags the bonus row, however the student left it', () => {
    // Extra credit is optional, so blank and wrong are the ordinary outcomes for
    // much of the class. One flag per student would bury the real anomalies.
    for (const raw of ['', '--', 'A;B', 'B']) {
      const row = gradeStudent({
        layout: layout40,
        responses: new Map([[92, raw]]),
        status: 'Graded',
        extraCredit,
      }).questions.at(-1)!
      expect(isFlagged(row)).toBe(false)
    }
  })

  it('still flags a real question left blank', () => {
    const row = gradeStudent({
      layout: layout40,
      responses: new Map(),
      status: 'Graded',
      extraCredit,
    }).questions[0]
    expect(row.verdict).toBe('blank')
    expect(isFlagged(row)).toBe(true)
  })
})

describe('an override on the bonus row', () => {
  it('replaces the computed score like any other row', () => {
    const result = gradeStudent({
      layout: layout40,
      responses: new Map([...allCorrect(), [92, '']]),
      status: 'Graded',
      extraCredit,
      overrides: new Map([[92, { awarded: 1, note: 'announced it late' }]]),
    })
    expect(result.earned).toBe(41)
    expect(result.possible).toBe(40)
    expect(result.questions.at(-1)!.overridden).toBe(true)
  })
})

describe('checkPositionCoverage with a bonus row', () => {
  const upTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

  it('accepts the unused columns between the last question and the bonus', () => {
    // Gradescope emits one column per row its assignment is configured for, so
    // reaching row 92 necessarily carries rows 41-91 along with it.
    expect(checkPositionCoverage(upTo(92), 40, 92)).toBeNull()
    expect(checkPositionCoverage(upTo(100), 40, 92)).toBeNull()
  })

  it('rejects an export that stops short of the bonus row', () => {
    const error = checkPositionCoverage(upTo(40), 40, 92)
    expect(error).toContain('at least 92')
  })

  it('still rejects an export that does not cover the questions', () => {
    expect(checkPositionCoverage(upTo(10), 40, 92)).toContain('at least 92')
  })

  it('keeps the exact-count check when the exam has no bonus row', () => {
    expect(checkPositionCoverage(upTo(40), 40)).toBeNull()
    expect(checkPositionCoverage(upTo(92), 40)).toContain('92 question column(s)')
    expect(checkPositionCoverage(upTo(10), 12)).toContain('10 question column(s)')
  })

  it('rejects a gappy column set either way', () => {
    expect(checkPositionCoverage([1, 2, 4], 3)).toContain('contiguous')
    expect(checkPositionCoverage([1, 2, 4], 3, 92)).toContain('contiguous')
  })
})
