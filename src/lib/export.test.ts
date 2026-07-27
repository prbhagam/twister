import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { MISSING_MARK, canvasCsv, scoresCsv, type ScoreRow } from './export'
import type { GradedQuestion } from './grading'

function question(position: number, letters: string[], awarded: number): GradedQuestion {
  return {
    position,
    rawResponse: letters.join(''),
    letters,
    verdict: awarded > 0 ? 'correct' : 'incorrect',
    awarded,
    possible: 1,
    correctLetter: 'A',
    overridden: false,
  }
}

function row(overrides: Partial<ScoreRow> & { lastName: string }): ScoreRow {
  const { lastName, ...rest } = overrides
  return {
    student: {
      firstName: 'Test',
      lastName,
      gtId: '903000101',
      username: 'nabbott3',
      email: 'nabbott3@example.edu',
      sections: ['O1'],
      traceCode: 'ABC123',
    },
    status: 'graded',
    earned: 2,
    possible: 3,
    questions: [question(1, ['A'], 1), question(2, ['A'], 1), question(3, ['B'], 0)],
    ...rest,
  }
}

const parse = (csv: string) => Papa.parse<Record<string, string>>(csv, { header: true }).data

describe('scoresCsv', () => {
  it('records M rather than 0 for a student with no scanned sheet', () => {
    // A zero asserts they sat the exam and got everything wrong. That is a
    // different claim from being absent, and only the instructor should make it.
    const rows = parse(
      scoresCsv([
        row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] }),
        row({ lastName: 'Present' }),
      ]),
    )

    const absent = rows.find((r) => r['Last Name'] === 'Absent')!
    expect(absent['Score']).toBe(MISSING_MARK)
    expect(absent['Percent']).toBe(MISSING_MARK)
    expect(absent['Status']).toBe('not_taken')

    const present = rows.find((r) => r['Last Name'] === 'Present')!
    expect(present['Score']).toBe('2')
    expect(present['Percent']).toBe('66.7')
  })

  it('marks every question column M for a missing student, not blank', () => {
    // Blank reads as "no data for this question"; M says the whole sheet is absent.
    // A graded student is included because the question columns only exist when
    // somebody in the run actually answered something.
    const rows = parse(
      scoresCsv([
        row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] }),
        row({ lastName: 'Present' }),
      ]),
    )
    const absent = rows.find((r) => r['Last Name'] === 'Absent')!
    expect(absent['Q1']).toBe(MISSING_MARK)
    expect(absent['Q2']).toBe(MISSING_MARK)
    expect(absent['Q3']).toBe(MISSING_MARK)
  })

  it('emits no question columns when nobody in the run was graded', () => {
    const csv = scoresCsv([row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] })])
    expect(csv.split('\n')[0]).not.toContain('Q1')
  })

  it('still reports the points the exam was out of', () => {
    const rows = parse(scoresCsv([row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] })]))
    expect(rows[0]['Possible']).toBe('3')
  })

  it('leaves a graded student untouched', () => {
    const rows = parse(scoresCsv([row({ lastName: 'Present' })]))
    expect(rows[0]['Q1']).toBe('A')
    expect(rows[0]['Q3']).toBe('B')
    expect(rows[0]['Score']).not.toBe(MISSING_MARK)
  })

  it('sorts alphabetically by last name', () => {
    const rows = parse(
      scoresCsv([row({ lastName: 'Zylstra' }), row({ lastName: 'Abbott' }), row({ lastName: 'Marchetti' })]),
    )
    expect(rows.map((r) => r['Last Name'])).toEqual(['Abbott', 'Marchetti', 'Zylstra'])
  })
})

describe('canvasCsv', () => {
  it('omits missing students entirely rather than sending M', () => {
    // Canvas would reject "M" as a grade; an absent student is left for the
    // instructor to mark excused or zero by hand.
    const csv = canvasCsv(
      [
        row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] }),
        row({ lastName: 'Present' }),
      ],
      'Exam 1',
    )
    const rows = parse(csv)
    expect(rows.map((r) => r['Student'])).toEqual(['Present, Test'])
    expect(csv).not.toContain(MISSING_MARK)
  })
})
