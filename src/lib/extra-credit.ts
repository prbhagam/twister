import { LETTERS } from './seed'

/**
 * What a correct extra-credit row is worth.
 *
 * Added to a student's `earned` and never to their `possible`, so a perfect
 * 40-question paper plus the bonus scores 41/40. That asymmetry is the whole
 * point of the feature and is why the bonus is not modelled as a Question: a
 * 41st question would raise the denominator for everyone.
 */
export const EXTRA_CREDIT_POINTS = 1

/**
 * Answer rows on the bubble sheet. The template is Gradescope's 100-question
 * v2020.05.01 sheet, so a row past 100 has no bubbles for a student to fill.
 */
export const SHEET_ROWS = 100

export interface ExtraCredit {
  /** 1-based bubble-sheet row the student marks, e.g. 92. */
  position: number
  /** The combination that earns the point. Canonically sorted — see `parseExtraCreditLetters`. */
  letters: string[]
}

/** The three settings as the exam form holds them, before they are known to be valid. */
export interface ExtraCreditConfig {
  /** Null switches the feature off for this exam. */
  position: number | null
  letters: string[]
  onPaper: boolean
}

/**
 * Reads a hand-typed combination into canonical letters, reporting anything it
 * could not use rather than dropping it silently.
 *
 * Forgiving about separators — `ACE`, `a c e`, and `A, C, E` all mean the same —
 * because this gets typed once and then read aloud to a room.
 *
 * The result is sorted and de-duplicated, which is correctness rather than
 * tidiness: one scantron row records a *set* of filled bubbles, and Gradescope
 * reports them in sheet order however the student filled them in. `CAE` and `ACE`
 * are physically the same paper, so they must not become two different keys.
 */
export function parseExtraCreditLetters(input: string): { letters: string[]; invalid: string[] } {
  const letters: string[] = []
  const invalid: string[] = []

  for (const char of input.toUpperCase().replace(/[\s,;./|+-]+/g, '')) {
    if ((LETTERS as readonly string[]).includes(char)) {
      if (!letters.includes(char)) letters.push(char)
    } else if (!invalid.includes(char)) {
      invalid.push(char)
    }
  }

  return { letters: letters.sort(), invalid }
}

/** "A, C and E" — for the printed instruction and the settings summary. */
export function formatExtraCreditLetters(letters: string[]): string {
  if (letters.length < 2) return letters.join('')
  return `${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]}`
}

/**
 * Problems that must block generation.
 *
 * All errors, no warnings: a misconfigured bonus is not a paper that prints
 * slightly oddly, it is a row the whole class is told to fill in that then grades
 * as nothing, or — worse — one that overwrites a real question's score.
 */
export function validateExtraCredit(
  config: Pick<ExtraCreditConfig, 'position' | 'letters'>,
  questionCount: number,
): string[] {
  const { position, letters } = config

  // Off. Letters left behind from a previous configuration are inert, but say so
  // rather than leaving the instructor wondering why no one got the point.
  if (position === null) {
    return letters.length > 0
      ? ['Extra credit has a letter combination but no question number, so it is switched off.']
      : []
  }

  const issues: string[] = []

  if (!Number.isInteger(position) || position < 1) {
    issues.push(`Extra credit question number must be a whole number of 1 or more (got ${position}).`)
  } else if (position > SHEET_ROWS) {
    issues.push(
      `Extra credit is set to question ${position}, but the Gradescope sheet only has ${SHEET_ROWS} rows. ` +
        `Pick a row a student can actually bubble.`,
    )
  } else if (position <= questionCount) {
    // The killer case: row 12 of a 40-question exam is question 12's own answer.
    // Both would grade off the same bubbles and the student could not satisfy either.
    issues.push(
      `Extra credit is set to question ${position}, but this exam already uses questions 1-${questionCount}. ` +
        `Pick a number above ${questionCount} so it does not collide with a real question.`,
    )
  }

  if (letters.length === 0) {
    issues.push('Extra credit has no letter combination, so there is nothing for a student to bubble.')
  }

  return issues
}

/**
 * The extra credit in force for an exam or a run, or null when there is none.
 *
 * Reads the same shape from either side: callers that grade pass the
 * GenerationRun (the frozen snapshot), callers that print or preview pass the
 * live Exam.
 */
export function readExtraCredit(source: {
  extraCreditPosition: number | null
  extraCreditLetters: string
}): ExtraCredit | null {
  if (source.extraCreditPosition === null) return null

  const letters = JSON.parse(source.extraCreditLetters) as string[]
  // A position with no letters cannot be satisfied by any paper. Treated as off so
  // it scores nobody, rather than marking the whole class incorrect.
  if (letters.length === 0) return null

  return { position: source.extraCreditPosition, letters }
}
