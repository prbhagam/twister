import type { LayoutEntry } from './seed'

/** Spare papers per session folder, for students who turn up at the wrong session. */
export const BLANKS_PER_SESSION = 3

/** "BLANK-07". Two digits minimum so a TA reading it aloud never drops a zero
 * that matters; numbers past 99 simply grow a digit. */
export function formatBlankLabel(number: number): string {
  return `BLANK-${String(number).padStart(2, '0')}`
}

/**
 * Reads back what a person typed for a blank's ID. Forgiving about case,
 * separators, and leading zeros ("blank 7", "BLANK-07", "07", "7" all mean
 * number 7), since it is copied by hand off a roster a TA filled in.
 */
export function parseBlankLabel(input: string): number | null {
  const match = /^\s*(?:blank)?[\s#_-]*(\d{1,6})\s*$/i.exec(input)
  if (!match) return null
  const number = Number(match[1])
  return number > 0 ? number : null
}

/**
 * The identity a blank's layout and version name are seeded from, in place of a
 * student's GT ID. Its shape can never collide with a real GT ID or username,
 * and it depends only on the number, so a blank's paper is reproducible.
 */
export function blankSeedIdentity(number: number): string {
  return `blank:${number}`
}

/** The file a blank's PDF is written to in the run directory. Student PDFs are
 * named Lastname-Firstname-id.pdf, so these can never collide with one. */
export function blankPdfFileName(number: number): string {
  return `${formatBlankLabel(number)}.pdf`
}

/**
 * Where a blank sits in a session folder of the by-session ZIP: straight after
 * the cover sheet (00-) and the instructions (01-), ahead of every student's
 * paper, so a TA finds the spares without hunting through the stack.
 */
export function blankZipEntryName(number: number): string {
  return `02-${blankPdfFileName(number)}`
}

interface PaperSource {
  layout: string
  traceCode: string
  blankExam?: { layout: string; traceCode: string } | null
}

/**
 * The layout a student's answers are graded against: the blank they wrote on
 * when they sat a different session, otherwise the paper generated for them.
 * Every place that pairs a student's bubbles with a key goes through here.
 */
export function answeredLayout(studentExam: PaperSource): LayoutEntry[] {
  return JSON.parse(studentExam.blankExam?.layout ?? studentExam.layout) as LayoutEntry[]
}

/** The exam code printed on the paper the student actually held. */
export function answeredTraceCode(studentExam: PaperSource): string {
  return studentExam.blankExam?.traceCode ?? studentExam.traceCode
}
