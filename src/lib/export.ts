import Papa from 'papaparse'
import { toPlainSummary } from './markdown'
import type { GradedQuestion } from './grading'
import { byLastName } from './roster'
import type { LayoutEntry } from './seed'

/** Recorded in place of a score when a student has no scanned sheet. */
export const MISSING_MARK = 'MI'

export interface ExportStudent {
  firstName: string
  lastName: string
  gtId: string | null
  username: string | null
  email: string
  sections: string[]
  traceCode: string
}

/**
 * Per-student answer key: which letter is correct at each bubble position, and
 * which question/variation that position actually came from.
 *
 * This is what makes an individualized exam auditable — without it there is no way
 * to check a disputed score against the paper.
 */
export function answerKeyCsv(
  rows: { student: ExportStudent; layout: LayoutEntry[] }[],
  questionLabels: Map<string, string>,
  variationLabels: Map<string, string>,
): string {
  const positions = Math.max(0, ...rows.map((r) => r.layout.length))
  const fields = [
    'Last Name',
    'First Name',
    'GT ID',
    'Username',
    'Exam Code',
    ...Array.from({ length: positions }, (_, i) => [`Q${i + 1} Key`, `Q${i + 1} Source`]).flat(),
  ]

  const data = rows
    .slice()
    .sort((a, b) => byLastName(a.student, b.student))
    .map(({ student, layout }) => {
      const byPosition = new Map(layout.map((e) => [e.position, e]))
      const cells: string[] = [
        student.lastName,
        student.firstName,
        student.gtId ?? '',
        student.username ?? '',
        student.traceCode,
      ]
      for (let p = 1; p <= positions; p++) {
        const entry = byPosition.get(p)
        cells.push(entry?.correctLetter ?? '')
        cells.push(
          entry
            ? `${questionLabels.get(entry.runQuestionId) ?? '?'}${variationLabels.get(entry.runVariationId) ?? ''}`
            : '',
        )
      }
      return cells
    })

  return Papa.unparse({ fields, data })
}

export interface ScoreRow {
  student: ExportStudent
  status: string
  earned: number
  possible: number
  questions: GradedQuestion[]
}

/** Gradebook export, alphabetical by last name. */
export function scoresCsv(rows: ScoreRow[]): string {
  const positions = Math.max(0, ...rows.map((r) => r.questions.length))
  const fields = [
    'Last Name',
    'First Name',
    'GT ID',
    'Username',
    'Email',
    'Sections',
    'Exam Code',
    'Status',
    'Score',
    'Possible',
    'Percent',
    ...Array.from({ length: positions }, (_, i) => `Q${i + 1}`),
  ]

  const data = rows
    .slice()
    .sort((a, b) => byLastName(a.student, b.student))
    .map((row) => {
      // A student with no scanned sheet gets "M", not 0: a zero asserts they sat the
      // exam and got everything wrong, which is a different claim from being absent.
      const missing = row.status === 'not_taken'
      const percent = row.possible > 0 ? (row.earned / row.possible) * 100 : 0

      const cells: (string | number)[] = [
        row.student.lastName,
        row.student.firstName,
        row.student.gtId ?? '',
        row.student.username ?? '',
        row.student.email,
        row.student.sections.join(' '),
        row.student.traceCode,
        row.status,
        missing ? MISSING_MARK : row.earned,
        row.possible,
        missing ? MISSING_MARK : percent.toFixed(1),
      ]
      const byPosition = new Map(row.questions.map((q) => [q.position, q]))
      for (let p = 1; p <= positions; p++) {
        const q = byPosition.get(p)
        if (missing) {
          cells.push(MISSING_MARK)
        } else {
          // What the student marked, with a * when a manual override changed it.
          cells.push(q ? `${q.letters.join('/') || '-'}${q.overridden ? '*' : ''}` : '')
        }
      }
      return cells
    })

  return Papa.unparse({ fields, data })
}

/**
 * Canvas gradebook import shape. Canvas matches on SIS User ID and ignores the
 * placeholder rows it normally round-trips, so only the identity columns and the
 * single assignment column are emitted.
 *
 * Students with no scanned sheet carry MISSING_MARK here, matching the scores
 * export, at the instructor's instruction. Canvas's own gradebook import accepts
 * numeric grades and `EX`; a non-numeric value like `MI` may be rejected or
 * ignored on import, so the preflight says so.
 */
export interface CanvasCsvOptions {
  /**
   * Leave out students with no scanned sheet entirely, rather than marking them.
   *
   * Off by default: every student appears, and one with no submission carries
   * MISSING_MARK. Turn it on when you only want to touch the students who sat the
   * exam — Canvas leaves a student's existing grade alone if they are not in the
   * file, so omitting is how you avoid overwriting a grade you set by hand.
   */
  submittedOnly?: boolean
}

export function canvasCsv(
  rows: ScoreRow[],
  assignmentName: string,
  options: CanvasCsvOptions = {},
): string {
  const fields = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', assignmentName]
  const data = rows
    .slice()
    .sort((a, b) => byLastName(a.student, b.student))
    .filter((row) => !options.submittedOnly || row.status !== 'not_taken')
    .map((row) => [
      `${row.student.lastName}, ${row.student.firstName}`,
      '',
      row.student.gtId ?? '',
      row.student.username ?? row.student.email.split('@')[0],
      row.student.sections[0] ?? '',
      row.status === 'not_taken' ? MISSING_MARK : row.earned,
    ])
  return Papa.unparse({ fields, data })
}

/**
 * Rows the Canvas gradebook import would reject, surfaced before you download the
 * CSV rather than after Canvas silently skips them.
 */
export function canvasPreflight(rows: ScoreRow[]): string[] {
  const problems: string[] = []

  // Canvas matches on SIS User ID; a student with neither identifier cannot match.
  const missingId = rows.filter(
    (r) => !/^\d{9}$/.test(r.student.gtId ?? '') && !r.student.username,
  )
  if (missingId.length) {
    problems.push(
      `${missingId.length} student(s) have neither a GT ID nor a username; Canvas cannot match them.`,
    )
  }

  const notTaken = rows.filter((r) => r.status === 'not_taken')
  if (notTaken.length) {
    problems.push(
      `${notTaken.length} student(s) have no scanned sheet and are exported as ${MISSING_MARK}. ` +
        `Canvas's gradebook import expects a number or EX, so it may reject or ignore ` +
        `${MISSING_MARK} — try a two-row file before importing the whole class.`,
    )
  }

  return problems
}

/** Flat dump of the frozen question bank for a run — the archival record. */
export function runQuestionsCsv(
  questions: {
    order: number
    points: number
    variations: {
      label: string
      promptMarkdown: string
      choices: { order: number; textMarkdown: string; isCorrect: boolean; pinToLast: boolean }[]
    }[]
  }[],
): string {
  const fields = ['Question', 'Points', 'Variation', 'Prompt', 'Choice #', 'Choice', 'Correct', 'Pinned']
  const data = questions.flatMap((q) =>
    q.variations.flatMap((v) =>
      v.choices.map((c) => [
        q.order,
        q.points,
        v.label,
        toPlainSummary(v.promptMarkdown, 500),
        c.order + 1,
        c.textMarkdown,
        c.isCorrect ? 'yes' : '',
        c.pinToLast ? 'yes' : '',
      ]),
    ),
  )
  return Papa.unparse({ fields, data })
}
