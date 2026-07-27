import Papa from 'papaparse'
import { toPlainSummary } from './markdown'
import type { GradedQuestion } from './grading'
import { byLastName } from './roster'
import type { LayoutEntry } from './seed'

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
        row.earned,
        row.possible,
        percent.toFixed(1),
      ]
      const byPosition = new Map(row.questions.map((q) => [q.position, q]))
      for (let p = 1; p <= positions; p++) {
        const q = byPosition.get(p)
        // What the student marked, with a * when a manual override changed the score.
        cells.push(q ? `${q.letters.join('/') || '-'}${q.overridden ? '*' : ''}` : '')
      }
      return cells
    })

  return Papa.unparse({ fields, data })
}

/**
 * Canvas gradebook import shape. Canvas matches on SIS User ID and ignores the
 * placeholder rows it normally round-trips, so only the identity columns and the
 * single assignment column are emitted.
 */
export function canvasCsv(rows: ScoreRow[], assignmentName: string): string {
  const fields = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', assignmentName]
  const data = rows
    .slice()
    .sort((a, b) => byLastName(a.student, b.student))
    .filter((r) => r.status !== 'not_taken')
    .map((row) => [
      `${row.student.lastName}, ${row.student.firstName}`,
      '',
      row.student.gtId ?? '',
      row.student.username ?? row.student.email.split('@')[0],
      row.student.sections[0] ?? '',
      row.earned,
    ])
  return Papa.unparse({ fields, data })
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
