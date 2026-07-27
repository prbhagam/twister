import Papa from 'papaparse'
import { candidateKeys, matchKeys } from './identity'
import { LETTERS, type LayoutEntry } from './seed'

export type Verdict = 'correct' | 'incorrect' | 'blank' | 'multi' | 'out_of_range'

export const VERDICT_LABEL: Record<Verdict, string> = {
  correct: 'Correct',
  incorrect: 'Incorrect',
  blank: 'Left blank',
  multi: 'Multiple bubbles',
  out_of_range: 'Bubbled a letter that does not exist',
}

/** Verdicts that warrant a human look before scores are published. */
export const FLAGGED: Verdict[] = ['blank', 'multi', 'out_of_range']

export interface GradescopeRow {
  studentId: string
  firstName: string
  lastName: string
  email: string
  status: string
  /** position (1-based) -> raw cell text */
  responses: Map<number, string>
}

export interface GradescopeCsv {
  positions: number[]
  rows: GradescopeRow[]
  errors: string[]
}

const RESPONSE_HEADER = /^Question (\d+) Student Response\(s\)$/i

/**
 * Gradescope's export has a variable number of `Question N ...` column groups, so
 * columns are discovered by pattern rather than by index.
 *
 * The `Question N Correct Response` columns are deliberately ignored: every student
 * sat a different paper, so Gradescope's notion of "correct" is meaningless here.
 * All that matters is which letter the student actually filled in.
 */
export function parseGradescopeCsv(csv: string): GradescopeCsv {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^﻿/, '').trim(),
  })

  const errors: string[] = []
  const fields = parsed.meta.fields ?? []

  const responseColumns = new Map<number, string>()
  for (const field of fields) {
    const match = RESPONSE_HEADER.exec(field)
    if (match) responseColumns.set(Number(match[1]), field)
  }

  if (!fields.includes('Student ID')) {
    errors.push('CSV has no "Student ID" column — is this a Gradescope bubble-sheet export?')
  }
  if (responseColumns.size === 0) {
    errors.push('CSV has no "Question N Student Response(s)" columns.')
  }
  if (errors.length) return { positions: [], rows: [], errors }

  const positions = [...responseColumns.keys()].sort((a, b) => a - b)

  const rows: GradescopeRow[] = parsed.data
    .filter((row) => (row['Student ID'] ?? '').trim())
    .map((row) => ({
      studentId: (row['Student ID'] ?? '').trim(),
      firstName: (row['First Name'] ?? '').trim(),
      lastName: (row['Last Name'] ?? '').trim(),
      email: (row['Email'] ?? '').trim(),
      status: (row['Status'] ?? '').trim(),
      responses: new Map(
        positions.map((p) => [p, (row[responseColumns.get(p)!] ?? '').trim()] as const),
      ),
    }))

  return { positions, rows, errors }
}

/**
 * Splits a response cell into letters. Gradescope writes multiple marks as `A;B`,
 * and `--` for rows it never scanned.
 */
export function parseLetters(raw: string): string[] {
  const cleaned = raw.trim()
  if (!cleaned || cleaned === '--') return []
  return cleaned
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean)
    .flatMap((token) => token.split(''))
}

export interface GradedQuestion {
  position: number
  rawResponse: string
  letters: string[]
  verdict: Verdict
  awarded: number
  possible: number
  correctLetter: string | null
  /** Set when an Override row replaced the computed score. */
  overridden: boolean
  overrideNote?: string
}

export function classify(letters: string[], entry: LayoutEntry): Verdict {
  if (letters.length === 0) return 'blank'
  if (letters.length > 1) return 'multi'

  const letter = letters[0]
  const index = LETTERS.indexOf(letter as (typeof LETTERS)[number])
  // The variation had fewer choices than the scantron offers — the student
  // bubbled a letter that was not printed on their paper.
  if (index === -1 || index >= entry.choiceCount) return 'out_of_range'

  return letter === entry.correctLetter ? 'correct' : 'incorrect'
}

export interface GradeResult {
  status: 'graded' | 'not_taken'
  earned: number
  possible: number
  questions: GradedQuestion[]
}

/**
 * Grades one student against their own frozen layout.
 *
 * Blank and multi-marked responses score 0 and are flagged; so does a letter beyond
 * the variation's choice count. Every one of those is overridable.
 */
export function gradeStudent(params: {
  layout: LayoutEntry[]
  responses: Map<number, string>
  status: string
  overrides?: Map<number, { awarded: number; note?: string | null }>
}): GradeResult {
  const { layout, responses, status, overrides } = params
  const possible = layout.reduce((sum, e) => sum + e.points, 0)

  // Gradescope marks students it never received a sheet for as "Missing".
  if (status.toLowerCase() === 'missing') {
    return { status: 'not_taken', earned: 0, possible, questions: [] }
  }

  const questions = layout
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((entry): GradedQuestion => {
      const rawResponse = responses.get(entry.position) ?? ''
      const letters = parseLetters(rawResponse)
      const verdict = classify(letters, entry)
      const override = overrides?.get(entry.position)

      return {
        position: entry.position,
        rawResponse,
        letters,
        verdict,
        awarded: override ? override.awarded : verdict === 'correct' ? entry.points : 0,
        possible: entry.points,
        correctLetter: entry.correctLetter,
        overridden: Boolean(override),
        overrideNote: override?.note ?? undefined,
      }
    })

  return {
    status: 'graded',
    earned: questions.reduce((sum, q) => sum + q.awarded, 0),
    possible,
    questions,
  }
}

export interface MatchReport {
  matched: { studentExamId: string; row: GradescopeRow }[]
  /** In the CSV but not in this run — a student who sat the exam without a roster entry. */
  csvOnly: { studentId: string; name: string }[]
  /** In this run but absent from the CSV — never scanned at all. */
  rosterOnly: { studentId: string; name: string }[]
  missingStatus: number
}

/**
 * Joins the Gradescope CSV to this run's students on GT ID.
 *
 * Both directions of mismatch are real and are surfaced rather than swallowed: the
 * sample export had one ID absent from the roster and 17 roster IDs absent from
 * the export.
 */
export function matchStudents(
  csvRows: GradescopeRow[],
  runStudents: {
    studentExamId: string
    gtId?: string | null
    username?: string | null
    firstName: string
    lastName: string
    email: string
  }[],
): MatchReport {
  // Index every identifier a student might be known by, so a roster keyed on GT ID
  // still grades against an export keyed on username, and vice versa.
  const index = new Map<string, (typeof runStudents)[number]>()
  for (const student of runStudents) {
    for (const key of matchKeys(student)) {
      if (!index.has(key)) index.set(key, student)
    }
  }

  const matched: MatchReport['matched'] = []
  const csvOnly: MatchReport['csvOnly'] = []
  const seen = new Set<string>()
  let missingStatus = 0

  for (const row of csvRows) {
    if (row.status.toLowerCase() === 'missing') missingStatus++

    const student =
      candidateKeys(row.studentId)
        .map((key) => index.get(key))
        .find(Boolean) ??
      candidateKeys(row.email)
        .map((key) => index.get(key))
        .find(Boolean)

    if (student) {
      matched.push({ studentExamId: student.studentExamId, row })
      seen.add(student.studentExamId)
    } else {
      csvOnly.push({ studentId: row.studentId, name: `${row.firstName} ${row.lastName}`.trim() })
    }
  }

  const rosterOnly = runStudents
    .filter((s) => !seen.has(s.studentExamId))
    .map((s) => ({
      studentId: s.gtId ?? s.username ?? s.email,
      name: `${s.firstName} ${s.lastName}`,
    }))

  return { matched, csvOnly, rosterOnly, missingStatus }
}

/**
 * Refuses an import whose question count does not match the run. A 10-question CSV
 * against a 12-question exam would otherwise silently score two questions as blank
 * for all 404 students.
 */
export function checkPositionCoverage(
  csvPositions: number[],
  runQuestionCount: number,
): string | null {
  if (csvPositions.length !== runQuestionCount) {
    return `This CSV has ${csvPositions.length} question column(s) but the run has ${runQuestionCount} question(s). Check that you exported the right Gradescope assignment.`
  }
  const expected = Array.from({ length: runQuestionCount }, (_, i) => i + 1)
  if (csvPositions.some((p, i) => p !== expected[i])) {
    return `Question columns are not a contiguous 1..${runQuestionCount} range: found ${csvPositions.join(', ')}.`
  }
  return null
}
