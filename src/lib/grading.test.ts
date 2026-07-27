import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkPositionCoverage,
  classify,
  gradeStudent,
  matchStudents,
  parseGradescopeCsv,
  parseLetters,
} from './grading'
import type { LayoutEntry } from './seed'

// Synthetic, committed. Reproduces the shapes of a real Gradescope bubble-sheet
// export: dynamic `Question N ...` column groups, Graded and Missing rows, "--"
// placeholders, a multi-mark, a blank, a lowercase mark, and an ID absent from the
// roster.
const FIXTURE = path.join(import.meta.dirname, '__fixtures__', 'gradescope.csv')

// A real export is student PII and is never committed; checked only if present.
const REAL_CSV = path.join(process.cwd(), 'assets', 'Gradescope Student Responses.csv')

function entry(position: number, correctLetter: string | null, choiceCount = 5, points = 1): LayoutEntry {
  return {
    position,
    runQuestionId: `q${position}`,
    runVariationId: `v${position}`,
    choiceOrder: Array.from({ length: choiceCount }, (_, i) => `c${i}`),
    correctLetter,
    choiceCount,
    points,
  }
}

describe('parseGradescopeCsv on a Gradescope-shaped export', () => {
  const result = parseGradescopeCsv(readFileSync(FIXTURE, 'utf8'))

  it('discovers the question columns by pattern, not by index', () => {
    expect(result.positions).toEqual([1, 2, 3])
    expect(result.errors).toEqual([])
  })

  it('reads every student row', () => {
    expect(result.rows).toHaveLength(4)
  })

  it('reads a graded row, including a multi-mark and a blank', () => {
    const row = result.rows.find((r) => r.studentId === '903000001')!
    expect(row.lastName).toBe('Abbott')
    expect(row.status).toBe('Graded')
    expect([...row.responses.values()]).toEqual(['C', 'A;B', ''])
  })

  it('carries Missing rows through instead of dropping them', () => {
    const missing = result.rows.filter((r) => r.status === 'Missing')
    expect(missing).toHaveLength(1)
    // Gradescope pads unscanned rows with "--" rather than leaving them empty.
    expect(missing[0].studentId).toBe('903000002')
  })

  it('ignores the Correct Response columns entirely', () => {
    // Every paper differs, so Gradescope's notion of "correct" is meaningless here.
    const row = result.rows.find((r) => r.studentId === '903000003')!
    expect(row.responses.get(1)).toBe('A')
    expect(Object.keys(row)).not.toContain('correctResponses')
  })
})

describe.skipIf(!existsSync(REAL_CSV))('parseGradescopeCsv on the real export', () => {
  it('discovers a contiguous set of question columns and reads every row', () => {
    const result = parseGradescopeCsv(readFileSync(REAL_CSV, 'utf8'))
    expect(result.errors).toEqual([])
    expect(result.positions.length).toBeGreaterThan(0)
    expect(result.positions).toEqual(result.positions.map((_, i) => i + 1))
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.every((r) => /^\d+$/.test(r.studentId))).toBe(true)
  })
})

describe('parseGradescopeCsv errors', () => {
  it('rejects a CSV with no Student ID column', () => {
    expect(parseGradescopeCsv('a,b\n1,2').errors[0]).toMatch(/Student ID/)
  })

  it('rejects a CSV with no response columns', () => {
    expect(parseGradescopeCsv('Student ID,Status\n903,Graded').errors[0]).toMatch(/Student Response/)
  })
})

describe('parseLetters', () => {
  it('reads a single mark', () => {
    expect(parseLetters('C')).toEqual(['C'])
  })

  it('reads Gradescope multi-marks', () => {
    expect(parseLetters('A;B')).toEqual(['A', 'B'])
    expect(parseLetters('A, B')).toEqual(['A', 'B'])
    expect(parseLetters('AB')).toEqual(['A', 'B'])
  })

  it('treats blank and the "--" placeholder as no mark', () => {
    expect(parseLetters('')).toEqual([])
    expect(parseLetters('--')).toEqual([])
    expect(parseLetters('   ')).toEqual([])
  })

  it('is case-insensitive', () => {
    expect(parseLetters('c')).toEqual(['C'])
  })
})

describe('classify', () => {
  it('scores a matching letter correct', () => {
    expect(classify(['C'], entry(1, 'C'))).toBe('correct')
  })

  it('scores a non-matching letter incorrect', () => {
    expect(classify(['D'], entry(1, 'C'))).toBe('incorrect')
  })

  it('flags a blank', () => {
    expect(classify([], entry(1, 'C'))).toBe('blank')
  })

  it('flags a multi-mark even when one of the marks is right', () => {
    expect(classify(['A', 'C'], entry(1, 'C'))).toBe('multi')
  })

  it('flags a letter past the end of a short variation', () => {
    // 3-choice variation: the paper only printed A, B, C.
    expect(classify(['E'], entry(1, 'B', 3))).toBe('out_of_range')
    expect(classify(['C'], entry(1, 'B', 3))).toBe('incorrect')
  })

  it('flags junk OCR output', () => {
    expect(classify(['X'], entry(1, 'B'))).toBe('out_of_range')
  })
})

describe('gradeStudent', () => {
  const layout = [entry(1, 'A'), entry(2, 'B'), entry(3, 'C', 3), entry(4, 'D', 5, 2)]

  it('sums points, weighting by the question value', () => {
    const result = gradeStudent({
      layout,
      responses: new Map([
        [1, 'A'],
        [2, 'B'],
        [3, 'C'],
        [4, 'D'],
      ]),
      status: 'Graded',
    })
    expect(result.earned).toBe(5) // 1 + 1 + 1 + 2
    expect(result.possible).toBe(5)
    expect(result.questions.every((q) => q.verdict === 'correct')).toBe(true)
  })

  it('awards nothing for blank, multi, or out-of-range', () => {
    const result = gradeStudent({
      layout,
      responses: new Map([
        [1, ''],
        [2, 'A;B'],
        [3, 'E'],
        [4, 'D'],
      ]),
      status: 'Graded',
    })
    expect(result.questions.map((q) => q.verdict)).toEqual(['blank', 'multi', 'out_of_range', 'correct'])
    expect(result.earned).toBe(2)
  })

  it('marks a Missing student as not_taken with the full possible points', () => {
    const result = gradeStudent({ layout, responses: new Map(), status: 'Missing' })
    expect(result.status).toBe('not_taken')
    expect(result.earned).toBe(0)
    expect(result.possible).toBe(5)
    expect(result.questions).toEqual([])
  })

  it('applies overrides and marks them as such', () => {
    const result = gradeStudent({
      layout,
      responses: new Map([[1, '']]),
      status: 'Graded',
      overrides: new Map([[1, { awarded: 1, note: 'scanner missed a faint mark' }]]),
    })
    expect(result.questions[0].awarded).toBe(1)
    expect(result.questions[0].overridden).toBe(true)
    expect(result.questions[0].overrideNote).toBe('scanner missed a faint mark')
    // The verdict still reports what was actually on the page.
    expect(result.questions[0].verdict).toBe('blank')
    expect(result.earned).toBe(1)
  })

  it('grades by bubble position, not by authoring order', () => {
    // Position 1 on this student's paper is question "q3" with correct letter C.
    const shuffled = [
      { ...entry(1, 'C'), runQuestionId: 'q3' },
      { ...entry(2, 'A'), runQuestionId: 'q1' },
    ]
    const result = gradeStudent({
      layout: shuffled,
      responses: new Map([
        [1, 'C'],
        [2, 'A'],
      ]),
      status: 'Graded',
    })
    expect(result.earned).toBe(2)
  })
})

describe('matchStudents', () => {
  const runStudents = [
    {
      studentExamId: 'se1',
      gtId: '903000101',
      username: 'nabbott3',
      firstName: 'Nadia',
      lastName: 'Abbott',
      email: 'z@gatech.edu',
    },
    {
      studentExamId: 'se2',
      gtId: '903000104',
      username: 'iduarte3',
      firstName: 'Ines',
      lastName: 'Duarte',
      email: 'a@gatech.edu',
    },
  ]

  const row = (studentId: string, email = '', status = 'Graded') => ({
    studentId,
    firstName: 'X',
    lastName: 'Y',
    email,
    status,
    responses: new Map<number, string>(),
  })

  it('joins on GT ID', () => {
    const report = matchStudents([row('903000101')], runStudents)
    expect(report.matched).toHaveLength(1)
    expect(report.matched[0].studentExamId).toBe('se1')
  })

  it('tolerates zero-padded IDs', () => {
    expect(matchStudents([row('0903000101')], runStudents).matched).toHaveLength(1)
  })

  it('matches an export keyed on usernames, not just GT IDs', () => {
    // Gradescope rosters are keyed on GT ID in some courses and on the GT account
    // in others, so grading must not assume which one the export carries.
    const report = matchStudents([row('nabbott3')], runStudents)
    expect(report.matched).toHaveLength(1)
    expect(report.matched[0].studentExamId).toBe('se1')
  })

  it('does not collapse usernames onto one student by stripping their digits', () => {
    // "nabbott3" and "iduarte3" both end in a digit; naive digit-stripping would
    // reduce them to "3" and "6" and mis-assign scores across the whole class.
    const report = matchStudents([row('nabbott3'), row('iduarte3')], runStudents)
    expect(report.matched.map((m) => m.studentExamId).sort()).toEqual(['se1', 'se2'])
    expect(report.csvOnly).toEqual([])
  })

  it('matches a student who has only a username', () => {
    const usernameOnly = [
      {
        studentExamId: 'se3',
        gtId: null,
        username: 'nosis3',
        firstName: 'No',
        lastName: 'Sis',
        email: 'nosis3@gatech.edu',
      },
    ]
    expect(matchStudents([row('nosis3')], usernameOnly).matched).toHaveLength(1)
  })

  it('falls back to email when the ID does not match', () => {
    expect(matchStudents([row('999999999', 'A@GATECH.EDU')], runStudents).matched[0].studentExamId).toBe('se2')
  })

  it('reports students in the CSV who are not in the run', () => {
    const report = matchStudents([row('903000106')], runStudents)
    expect(report.csvOnly).toEqual([{ studentId: '903000106', name: 'X Y' }])
  })

  it('reports run students who never appear in the CSV', () => {
    const report = matchStudents([row('903000101')], runStudents)
    expect(report.rosterOnly).toEqual([{ studentId: '903000104', name: 'Ines Duarte' }])
  })

  it('counts Missing rows', () => {
    expect(matchStudents([row('903000101', '', 'Missing')], runStudents).missingStatus).toBe(1)
  })
})

describe('checkPositionCoverage', () => {
  it('rejects a 10-question CSV against a 12-question run', () => {
    const error = checkPositionCoverage([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 12)
    expect(error).toMatch(/10 question column\(s\) but the run has 12/)
  })

  it('accepts a matching contiguous range', () => {
    expect(checkPositionCoverage([1, 2, 3], 3)).toBeNull()
  })

  it('rejects a non-contiguous range', () => {
    expect(checkPositionCoverage([1, 2, 5], 3)).toMatch(/contiguous/)
  })
})
