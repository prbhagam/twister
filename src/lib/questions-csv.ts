import Papa from 'papaparse'
import { MAX_CHOICES } from './seed'
import { normalizeVersionNames } from './version-names'

export interface ImportedChoice {
  textMarkdown: string
  isCorrect: boolean
  pinToLast: boolean
}

export interface ImportedVariation {
  label: string
  promptMarkdown: string
  choices: ImportedChoice[]
}

export interface ImportedQuestion {
  /** Only present in the whole-exam format. */
  questionNumber?: number
  points?: number
  /** Only meaningful in the whole-exam format; the per-question format has no
   * column for it, since that format never touches the Question row. */
  allowMultipleCorrect?: boolean
  variations: ImportedVariation[]
}

export interface QuestionCsvResult {
  questions: ImportedQuestion[]
  /**
   * Every name in the `version_name` column, top to bottom, normalized. Null when
   * the file has no such column at all — which is not the same as an empty
   * column: an older CSV without it must leave the exam's names alone, while a
   * present-but-empty column deliberately clears them.
   */
  versionNames: string[] | null
  errors: string[]
  warnings: string[]
}

const CHOICE_COLUMNS = Array.from({ length: MAX_CHOICES }, (_, i) => `choice_${i + 1}`)

export const SINGLE_QUESTION_HEADER = ['variation_label', 'prompt', ...CHOICE_COLUMNS, 'correct', 'pin_last']
/**
 * `version_name` is last so every earlier column keeps its position. It is
 * unrelated to the question on its row: each cell holds one decorative version
 * name for the whole exam, read top to bottom. A row carrying only a
 * version_name (every question column blank) is allowed, for lists longer than
 * the question rows.
 */
export const WHOLE_EXAM_HEADER = ['question_number', 'points', 'allow_multiple', ...SINGLE_QUESTION_HEADER, 'version_name']

/** Every column that describes a question — blank across all of these marks a
 * row that exists only to carry a version name. */
const QUESTION_COLUMNS = WHOLE_EXAM_HEADER.filter((c) => c !== 'version_name')

export const CSV_TEMPLATE = [
  SINGLE_QUESTION_HEADER.join(','),
  'A,"What does `len([1, 2, 3])` return?",2,3,4,"`TypeError`","None of the above",2,5',
  'B,"What does `len(\'cat\')` return?",1,2,3,4,"None of the above",3,5',
].join('\n')

function parseIndexList(raw: string): number[] {
  return raw
    .split(/[,;\s]+/)
    .map((t) => Number(t.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1)
}

const TRUTHY = new Set(['1', 'true', 'yes', 'y'])
function parseBool(raw: string): boolean {
  return TRUTHY.has(raw.trim().toLowerCase())
}

/**
 * Parses either the per-question format (one row per variation) or the whole-exam
 * format (same columns, prefixed with question_number, points, and allow_multiple).
 *
 * `correct` and `pin_last` are 1-based indices into the *authored* choice columns,
 * not letters — the printed letters differ per student, so letters would be
 * meaningless here. `correct` may list more than one index only in the whole-exam
 * format, and only for a question whose first row has `allow_multiple` set — this
 * keeps a second index typed by accident an error rather than a silent
 * select-all-that-apply question.
 *
 * The per-question format has no `allow_multiple` column of its own — pass
 * `allowMultipleCorrect` to say whether the *target* question (whatever it
 * already is on the exam) allows more than one index in `correct`.
 */
export function parseQuestionCsv(
  csv: string,
  options: { allowMultipleCorrect?: boolean } = {},
): QuestionCsvResult {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^﻿/, '').trim().toLowerCase(),
  })

  const errors: string[] = []
  const warnings: string[] = []
  const fields = parsed.meta.fields ?? []

  const wholeExam = fields.includes('question_number')
  const required = wholeExam ? ['question_number', 'prompt', 'correct'] : ['prompt', 'correct']
  const missing = required.filter((f) => !fields.includes(f))
  if (missing.length) {
    return {
      questions: [],
      versionNames: null,
      errors: [
        `CSV is missing required column(s): ${missing.join(', ')}. Expected header: ${(wholeExam ? WHOLE_EXAM_HEADER : SINGLE_QUESTION_HEADER).join(',')}`,
      ],
      warnings,
    }
  }

  // Preserve first-seen order so questions land in the order the file lists them.
  const byQuestion = new Map<string, ImportedQuestion>()
  const hasVersionColumn = fields.includes('version_name')
  const rawVersionNames: string[] = []

  parsed.data.forEach((row, i) => {
    const line = i + 2
    const versionName = (row['version_name'] ?? '').trim()
    if (versionName) rawVersionNames.push(versionName)
    if (versionName && QUESTION_COLUMNS.every((c) => !(row[c] ?? '').trim())) return

    const prompt = (row['prompt'] ?? '').trim()
    const groupKey = wholeExam ? (row['question_number'] ?? '').trim() : '1'

    if (!prompt) {
      errors.push(`Line ${line}: prompt is empty.`)
      return
    }
    if (wholeExam && !groupKey) {
      errors.push(`Line ${line}: question_number is empty.`)
      return
    }

    const rawChoices = CHOICE_COLUMNS.map((c) => (row[c] ?? '').trim())
    // Trailing blanks mean "fewer than 5 choices"; an interior blank is a mistake.
    const lastFilled = rawChoices.reduce((acc, v, idx) => (v ? idx : acc), -1)
    const choicesText = rawChoices.slice(0, lastFilled + 1)

    if (choicesText.some((c) => !c)) {
      errors.push(
        `Line ${line}: blank choice column between filled ones — leave gaps only at the end.`,
      )
      return
    }
    if (choicesText.length < 2) {
      errors.push(`Line ${line}: needs at least 2 choices, found ${choicesText.length}.`)
      return
    }
    if (choicesText.length < MAX_CHOICES) {
      warnings.push(
        `Line ${line}: only ${choicesText.length} choices, but the scantron always offers A-E. ` +
          `A student who bubbles a letter past ${String.fromCharCode(64 + choicesText.length)} scores 0 and is flagged for review.`,
      )
    }

    // Only the group's first row sets allow_multiple, the same way only its first
    // row's points column is read — later rows repeating (or omitting) it are ignored.
    const existing = byQuestion.get(groupKey)
    const allowMultiple = wholeExam
      ? (existing?.allowMultipleCorrect ?? parseBool(row['allow_multiple'] ?? ''))
      : Boolean(options.allowMultipleCorrect)

    const correctIndices = [...new Set(parseIndexList(row['correct'] ?? ''))]
    if (correctIndices.length === 0) {
      errors.push(`Line ${line}: "correct" needs at least one 1-based choice index.`)
      return
    }
    if (correctIndices.length > 1 && !allowMultiple) {
      errors.push(
        `Line ${line}: "correct" lists ${correctIndices.length} indices, but this question does not have ` +
          `allow_multiple set. Set allow_multiple on its first row for a select-all-that-apply question, ` +
          `or mark just one choice correct.`,
      )
      return
    }
    const tooHigh = correctIndices.filter((n) => n > choicesText.length)
    if (tooHigh.length) {
      errors.push(
        `Line ${line}: correct=${tooHigh.join(',')} but there are only ${choicesText.length} choices.`,
      )
      return
    }

    const pinned = new Set(parseIndexList(row['pin_last'] ?? ''))
    for (const p of pinned) {
      if (p > choicesText.length) {
        warnings.push(`Line ${line}: pin_last=${p} is beyond the last choice and was ignored.`)
      }
    }

    const variation: ImportedVariation = {
      label: (row['variation_label'] ?? '').trim() || String.fromCharCode(65 + (existing?.variations.length ?? 0)),
      promptMarkdown: prompt,
      choices: choicesText.map((text, idx) => ({
        textMarkdown: text,
        isCorrect: correctIndices.includes(idx + 1),
        pinToLast: pinned.has(idx + 1),
      })),
    }

    if (existing) {
      existing.variations.push(variation)
    } else {
      byQuestion.set(groupKey, {
        questionNumber: wholeExam ? Number(groupKey) : undefined,
        points: row['points'] ? Number(row['points']) : undefined,
        allowMultipleCorrect: allowMultiple,
        variations: [variation],
      })
    }
  })

  for (const [key, q] of byQuestion) {
    if (q.variations.every((v) => v.choices.every((c) => c.pinToLast))) {
      errors.push(`Question ${key}: every choice is pinned, so nothing would shuffle.`)
    }
  }

  let versionNames: string[] | null = null
  if (hasVersionColumn) {
    const normalized = normalizeVersionNames(rawVersionNames)
    versionNames = normalized.names
    for (const name of normalized.duplicates) {
      warnings.push(`Version name "${name}" is listed more than once; it was kept once.`)
    }
  }

  return { questions: [...byQuestion.values()], versionNames, errors, warnings }
}

interface ExportableQuestion {
  order: number
  points: number
  allowMultipleCorrect: boolean
  variations: {
    label: string
    promptMarkdown: string
    choices: { textMarkdown: string; isCorrect: boolean; pinToLast: boolean }[]
  }[]
}

/**
 * Round-trips back to the import format, so you can edit in a spreadsheet and
 * re-upload. The whole-exam format also carries the exam's version names, one
 * per row down the `version_name` column, with name-only rows appended if there
 * are more names than question rows.
 */
export function toQuestionCsv(
  questions: ExportableQuestion[],
  includeQuestionNumber: boolean,
  versionNames: readonly string[] = [],
): string {
  const header = includeQuestionNumber ? WHOLE_EXAM_HEADER : SINGLE_QUESTION_HEADER
  const rows = questions.flatMap((q) =>
    q.variations.map((v) => {
      const cells: (string | number)[] = []
      if (includeQuestionNumber) cells.push(q.order, q.points, q.allowMultipleCorrect ? 1 : 0)
      cells.push(v.label, v.promptMarkdown)
      for (let i = 0; i < MAX_CHOICES; i++) cells.push(v.choices[i]?.textMarkdown ?? '')
      cells.push(
        v.choices
          .map((c, i) => (c.isCorrect ? i + 1 : 0))
          .filter(Boolean)
          .join(' '),
      )
      cells.push(
        v.choices
          .map((c, i) => (c.pinToLast ? i + 1 : 0))
          .filter(Boolean)
          .join(' '),
      )
      return cells
    }),
  )

  if (includeQuestionNumber) {
    versionNames.forEach((name, i) => {
      if (i < rows.length) rows[i].push(name)
      else rows.push([...QUESTION_COLUMNS.map(() => ''), name])
    })
    // Pad so every row has the full width; Papa would otherwise leave them ragged.
    for (const row of rows) while (row.length < header.length) row.push('')
  }

  return Papa.unparse({ fields: header, data: rows })
}
