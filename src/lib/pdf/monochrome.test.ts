import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../markdown'
import { buildExamBody, buildShellHtml, footerTemplate, type RenderExam } from './exam-html'
import { buildBankShell } from './question-bank'
import { buildReportShell } from './graded-report'

/**
 * The exam booklet — and the practice exam, which is the same renderer with a
 * sample identity — is printed in bulk on a black-and-white laser printer, so a
 * colour that reads as meaningful on screen is either invisible or identical to
 * some other colour by the time a student holds it. This holds that line
 * mechanically, because the failure is silent: a coloured tag looks perfect in the
 * editor preview and only goes wrong on paper, a few hundred copies at a time.
 *
 * Scope matters as much as the rule. The graded report, the question bank, and the
 * review UI are read on screen and are meant to keep their colour; the last block
 * here guards that they were not swept up by accident.
 */

/** Any hex or rgb() colour in the markup, normalised to 8-bit channels. */
function extractColors(html: string): { raw: string; rgb: [number, number, number] }[] {
  const out: { raw: string; rgb: [number, number, number] }[] = []

  for (const [raw, hex] of html.matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)) {
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex
    out.push({
      raw,
      rgb: [
        Number.parseInt(full.slice(0, 2), 16),
        Number.parseInt(full.slice(2, 4), 16),
        Number.parseInt(full.slice(4, 6), 16),
      ],
    })
  }

  for (const match of html.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    out.push({ raw: match[0], rgb: [Number(match[1]), Number(match[2]), Number(match[3])] })
  }

  return out
}

/** A colour is achromatic when its three channels are equal — pure grey. */
function chromaticColors(html: string): string[] {
  return [
    ...new Set(
      extractColors(html)
        .filter(({ rgb: [r, g, b] }) => r !== g || g !== b)
        .map((c) => c.raw),
    ),
  ]
}

const exam: RenderExam = {
  examTitle: 'Exam 1',
  courseName: 'CS 1301 — Introduction to Computing',
  studentName: 'Nadia Abbott',
  gtId: '903000101',
  traceCode: 'ABC123',
  instructionsHtml: '<p>75 minutes. Bubble every answer.</p>',
  katexHref: 'katex.min.css',
  questions: [
    {
      position: 1,
      points: 1,
      promptHtml: '<p>What does <code>len("cat")</code> return?</p>',
      choicesHtml: ['<p>2</p>', '<p>3</p>', '<p>4</p>'],
    },
  ],
}

describe('the printed booklet is monochrome', () => {
  const documents: [string, string][] = [
    ['exam shell', buildShellHtml('katex.min.css')],
    ['exam body', buildExamBody(exam)],
    ['exam footer', footerTemplate(exam)],
  ]

  for (const [name, html] of documents) {
    it(`${name} uses only greys`, () => {
      expect(chromaticColors(html)).toEqual([])
    })
  }

  it('selects the greyscale code palette', () => {
    // Rendered markdown carries both palettes; picking the wrong one here would put
    // a full colour theme on the printed paper.
    const css = buildShellHtml(null)
    expect(css).toContain('color: var(--twister-print)')
    expect(css).not.toContain('--twister-screen')
  })

  it('has nothing colourful in the greyscale code palette itself', async () => {
    const html = await renderMarkdown('```python\n# a note\ndef f(xs):\n    return len("cat")\n```')

    const printTokens = [...html.matchAll(/--twister-print:(#[0-9A-Fa-f]{6})/g)].map((m) => m[1])
    expect(printTokens.length).toBeGreaterThan(0)
    expect(printTokens.flatMap((c) => chromaticColors(c))).toEqual([])

    // Greys alone would be a wall of near-identical tokens on paper, so weight and
    // slant do the real work.
    expect(html).toContain('--twister-print-font-weight:bold')
    expect(html).toContain('--twister-print-font-style:italic')
  })
})

describe('on-screen documents keep their colour', () => {
  // Only the booklet is printed. Sweeping these into greyscale as well would strip
  // the graded report of the green and red that tell a student which answer was
  // right and which one they marked.
  it('the graded report selects the colour code palette', () => {
    const css = buildReportShell(null)
    expect(css).toContain('color: var(--twister-screen)')
    expect(chromaticColors(css).length).toBeGreaterThan(0)
  })

  it('the question bank selects the colour code palette', () => {
    const css = buildBankShell(null)
    expect(css).toContain('color: var(--twister-screen)')
    expect(chromaticColors(css).length).toBeGreaterThan(0)
  })
})
