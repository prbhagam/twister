import { describe, expect, it } from 'vitest'
import { buildKeyBody, keyFooter, keyTotals, type KeyVariant, type PracticeKey } from './practice-key'

/** `tag` only names the fixture text; the key itself carries no such label. */
function entry(position: number, tag: string, correct: string[], points = 1) {
  const letters = ['A', 'B', 'C', 'D', 'E']
  return {
    position,
    points,
    correctLetters: correct,
    promptHtml: `<p>Prompt for ${tag}</p>`,
    choices: letters.map((letter) => ({
      letter,
      html: `<p>choice ${letter} of ${tag}</p>`,
      correct: correct.includes(letter),
    })),
  }
}

const variantA: KeyVariant = {
  label: 'A',
  traceCode: 'CDEAA7',
  entries: [
    entry(1, 'first', ['C', 'D']),
    entry(2, 'second', ['C']),
    entry(3, 'third', ['A'], 2),
  ],
}

const key: PracticeKey = {
  courseName: 'CS 1301 — Introduction to Computing',
  examTitle: 'Practice Exam 1',
  generatedOn: '2026-10-04',
  variants: [variantA, { ...variantA, label: 'B', traceCode: 'A9D157' }],
}

describe('keyTotals', () => {
  it('sums points rather than counting questions', () => {
    // A 2-point question makes these differ, which is the whole reason the header
    // prints both.
    expect(keyTotals(variantA)).toEqual({ questions: 3, points: 4 })
  })
})

describe('buildKeyBody', () => {
  const html = buildKeyBody(key)

  it('renders one section per variant, each with its own trace code', () => {
    expect(html.match(/class="variant"/g)).toHaveLength(2)
    expect(html).toContain('CDEAA7')
    expect(html).toContain('A9D157')
    expect(html).toContain('Practice Exam 1 A')
    expect(html).toContain('Practice Exam 1 B')
  })

  it('puts the grid before the marked-up paper', () => {
    // The grid is what you score against; burying it behind the questions would
    // mean flipping past every one of them to reach it.
    const grid = html.indexOf('class="gridhead"')
    const paper = html.indexOf('class="paperhead"')
    expect(grid).toBeGreaterThan(-1)
    expect(paper).toBeGreaterThan(grid)
  })

  it('shows a select-all key as a letter group', () => {
    expect(html).toContain('>CD<')
  })

  it('leaks nothing about how the bank is authored', () => {
    // This document is posted for students. A "Q3B" provenance label, a variation
    // name, or a workflow status would tell them how the bank is built and let
    // them line up the variants against each other.
    expect(html).not.toMatch(/Q\d+[A-Z]\b/)
    expect(html).not.toContain('variation')
    expect(html).not.toContain('authored')
    expect(html).not.toMatch(/APPROVED|DRAFT|IN_REVIEW|RETIRED/)
  })

  it('tells the student to check the version before scoring', () => {
    // The one way to get this wrong is to score variant A's paper against
    // variant B's key, which lines up just enough to look plausible.
    expect(html).toContain('version letter')
    expect(html).toContain('exam code')
  })

  it('shows points only where they are not 1, to keep the grid scannable', () => {
    expect(html).toContain('2 pts')
    expect(html).not.toContain('1 pts')
  })

  it('marks exactly the correct choices in the paper, and no others', () => {
    // One tick per correct letter across both variants: 2 + 1 + 1 per variant.
    expect(html.match(/&#10003;/g)).toHaveLength(8)
    expect(html.match(/class="correct"/g)).toHaveLength(8)
  })

  it('reports extra credit when configured, saying whether it was printed', () => {
    const printed = buildKeyBody({
      ...key,
      extraCredit: { position: 92, letters: ['A', 'C', 'E'], onPaper: true },
    })
    expect(printed).toContain('question 92')
    expect(printed).toContain('A, C and E')
    expect(printed).not.toContain('not printed on your paper')

    const unprinted = buildKeyBody({
      ...key,
      extraCredit: { position: 92, letters: ['A', 'C', 'E'], onPaper: false },
    })
    // The bonus scores either way, so a key that hid it would be incomplete — and
    // a student who never saw it on their paper needs telling why.
    expect(unprinted).toContain('not printed on your paper')
  })

  it('omits the extra-credit block when the exam has none', () => {
    expect(html).not.toContain('Extra credit')
  })

  it('is not marked as an instructor document anywhere', () => {
    // It is a handout, and labelling it otherwise invites an instructor not to post it.
    const footer = keyFooter(key)
    for (const text of [html, footer]) {
      expect(text.toLowerCase()).not.toContain('instructor')
      expect(text.toLowerCase()).not.toContain('do not hand out')
    }
  })

  it('escapes variant labels and titles rather than injecting them raw', () => {
    const nasty = buildKeyBody({
      ...key,
      examTitle: 'Exam <script>alert(1)</script>',
      variants: [{ ...variantA, label: 'A & B' }],
    })
    expect(nasty).not.toContain('<script>')
    expect(nasty).toContain('&lt;script&gt;')
    expect(nasty).toContain('A &amp; B')
  })
})
