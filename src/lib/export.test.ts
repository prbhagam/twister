import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import { MISSING_MARK, canvasCsv, canvasPreflight, scoresCsv, type ScoreRow } from './export'
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
  it('records the missing mark rather than 0 for a student with no scanned sheet', () => {
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

  it('marks every question column with the missing mark, not blank', () => {
    // Blank reads as "no data for this question"; the mark says the sheet is absent.
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

describe('canvasPreflight', () => {
  it('warns that Canvas may not accept the missing mark', () => {
    const [message] = canvasPreflight([
      row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] }),
    ])
    expect(message).toContain(MISSING_MARK)
    expect(message).toMatch(/reject or ignore/)
    expect(message).not.toMatch(/omitted rather than being given a zero/)
  })

  it('says nothing about missing students when everyone sat the exam', () => {
    expect(canvasPreflight([row({ lastName: 'Present' })])).toEqual([])
  })
})

describe('canvasCsv', () => {
  it('includes missing students, marked with the missing mark', () => {
    const rows = parse(
      canvasCsv(
        [
          row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] }),
          row({ lastName: 'Present' }),
        ],
        'Exam 1',
      ),
    )
    expect(rows.map((r) => r['Student'])).toEqual(['Absent, Test', 'Present, Test'])
    // Read from the grade cell rather than searching the whole file, which would
    // also match any student whose name contains those letters.
    expect(rows.find((r) => r['Student'] === 'Absent, Test')!['Exam 1']).toBe(MISSING_MARK)
    expect(rows.find((r) => r['Student'] === 'Present, Test')!['Exam 1']).toBe('2')
  })

  it('agrees with the scores export on who is missing', () => {
    const input = [
      row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] }),
      row({ lastName: 'Present' }),
    ]
    const canvasMarks = new Map(
      parse(canvasCsv(input, 'Exam 1')).map((r) => [r['Student'].split(',')[0], r['Exam 1']]),
    )
    const scoreMarks = new Map(parse(scoresCsv(input)).map((r) => [r['Last Name'], r['Score']]))
    for (const name of ['Absent', 'Present']) {
      expect(canvasMarks.get(name)).toBe(scoreMarks.get(name))
    }
  })

  it('omits students with no submission when submittedOnly is set', () => {
    // Canvas leaves a student's existing grade alone if they are absent from the
    // file, which is the point: it avoids overwriting one set by hand.
    const rows = parse(
      canvasCsv(
        [
          row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] }),
          row({ lastName: 'Present' }),
        ],
        'Exam 1',
        { submittedOnly: true },
      ),
    )
    expect(rows.map((r) => r['Student'])).toEqual(['Present, Test'])
  })

  it('includes everyone by default, so the option has to be asked for', () => {
    const rows = parse(
      canvasCsv(
        [
          row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] }),
          row({ lastName: 'Present' }),
        ],
        'Exam 1',
      ),
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r['Student'] === 'Absent, Test')!['Exam 1']).toBe(MISSING_MARK)
  })

  it('still emits a header when every student is filtered out', () => {
    // An empty file would be silently useless; a header-only file is obviously so.
    const csv = canvasCsv(
      [row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] })],
      'Exam 1',
      { submittedOnly: true },
    )
    expect(csv.split('\n')[0]).toContain('SIS User ID')
    // Asserted on the file rather than through the parser, which reports a phantom
    // empty row for a header-only document.
    expect(csv.split('\n').filter((l) => l.trim())).toHaveLength(1)
  })

  it('does not change the grades of students who did submit', () => {
    const input = [
      row({ lastName: 'Absent', status: 'not_taken', earned: 0, questions: [] }),
      row({ lastName: 'Present', earned: 41 }),
    ]
    const withAll = parse(canvasCsv(input, 'Exam 1'))
    const withOnly = parse(canvasCsv(input, 'Exam 1', { submittedOnly: true }))
    const grade = (rs: Record<string, string>[]) =>
      rs.find((r) => r['Student'] === 'Present, Test')!['Exam 1']
    expect(grade(withOnly)).toBe(grade(withAll))
    expect(grade(withOnly)).toBe('41')
  })

  it('matches students on SIS User ID', () => {
    const rows = parse(canvasCsv([row({ lastName: 'Present' })], 'Exam 1'))
    expect(rows[0]['SIS User ID']).toBe('903000101')
  })
})
