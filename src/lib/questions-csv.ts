import Papa from 'papaparse'
import { MAX_CHOICES } from './seed'

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
  variations: ImportedVariation[]
}

export interface QuestionCsvResult {
  questions: ImportedQuestion[]
  errors: string[]
  warnings: string[]
}

const CHOICE_COLUMNS = Array.from({ length: MAX_CHOICES }, (_, i) => `choice_${i + 1}`)

export const SINGLE_QUESTION_HEADER = ['variation_label', 'prompt', ...CHOICE_COLUMNS, 'correct', 'pin_last']
export const WHOLE_EXAM_HEADER = ['question_number', 'points', ...SINGLE_QUESTION_HEADER]

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

/**
 * Parses either the per-question format (one row per variation) or the whole-exam
 * format (same columns, prefixed with question_number and points).
 *
 * `correct` and `pin_last` are 1-based indices into the *authored* choice columns,
 * not letters — the printed letters differ per student, so letters would be
 * meaningless here.
 */
export function parseQuestionCsv(csv: string): QuestionCsvResult {
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
      errors: [
        `CSV is missing required column(s): ${missing.join(', ')}. Expected header: ${(wholeExam ? WHOLE_EXAM_HEADER : SINGLE_QUESTION_HEADER).join(',')}`,
      ],
      warnings,
    }
  }

  // Preserve first-seen order so questions land in the order the file lists them.
  const byQuestion = new Map<string, ImportedQuestion>()

  parsed.data.forEach((row, i) => {
    const line = i + 2
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

    const correctIndices = parseIndexList(row['correct'] ?? '')
    if (correctIndices.length !== 1) {
      errors.push(`Line ${line}: "correct" must be exactly one 1-based choice index.`)
      return
    }
    const correct = correctIndices[0]
    if (correct > choicesText.length) {
      errors.push(
        `Line ${line}: correct=${correct} but there are only ${choicesText.length} choices.`,
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
      label: (row['variation_label'] ?? '').trim() || String.fromCharCode(65 + (byQuestion.get(groupKey)?.variations.length ?? 0)),
      promptMarkdown: prompt,
      choices: choicesText.map((text, idx) => ({
        textMarkdown: text,
        isCorrect: idx + 1 === correct,
        pinToLast: pinned.has(idx + 1),
      })),
    }

    const existing = byQuestion.get(groupKey)
    if (existing) {
      existing.variations.push(variation)
    } else {
      byQuestion.set(groupKey, {
        questionNumber: wholeExam ? Number(groupKey) : undefined,
        points: row['points'] ? Number(row['points']) : undefined,
        variations: [variation],
      })
    }
  })

  for (const [key, q] of byQuestion) {
    if (q.variations.every((v) => v.choices.every((c) => c.pinToLast))) {
      errors.push(`Question ${key}: every choice is pinned, so nothing would shuffle.`)
    }
  }

  return { questions: [...byQuestion.values()], errors, warnings }
}

interface ExportableQuestion {
  order: number
  points: number
  variations: {
    label: string
    promptMarkdown: string
    choices: { textMarkdown: string; isCorrect: boolean; pinToLast: boolean }[]
  }[]
}

/** Round-trips back to the import format, so you can edit in a spreadsheet and re-upload. */
export function toQuestionCsv(questions: ExportableQuestion[], includeQuestionNumber: boolean): string {
  const header = includeQuestionNumber ? WHOLE_EXAM_HEADER : SINGLE_QUESTION_HEADER
  const rows = questions.flatMap((q) =>
    q.variations.map((v) => {
      const cells: (string | number)[] = []
      if (includeQuestionNumber) cells.push(q.order, q.points)
      cells.push(v.label, v.promptMarkdown)
      for (let i = 0; i < MAX_CHOICES; i++) cells.push(v.choices[i]?.textMarkdown ?? '')
      cells.push(v.choices.findIndex((c) => c.isCorrect) + 1)
      cells.push(
        v.choices
          .map((c, i) => (c.pinToLast ? i + 1 : 0))
          .filter(Boolean)
          .join(' '),
      )
      return cells
    }),
  )
  return Papa.unparse({ fields: header, data: rows })
}
