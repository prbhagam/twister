import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import {
  buildKeyBody,
  buildKeyShell,
  keyFooter,
  type KeyEntry,
  type KeyVariant,
  type PracticeKey,
} from './pdf/practice-key'
import { loadPracticeContext } from './practice-exam'
import { stageKatex } from './pdf/renderer'
import { LETTERS } from './seed'

export interface PracticeKeyResult {
  pdf: Uint8Array
  examTitle: string
  variantCount: number
  /** Set when the key covers a single variant rather than every one. */
  variantLabel?: string
}

/**
 * Collects the answer key for a practice exam's variants.
 *
 * Built from `loadPracticeContext`, the same call the practice paper is built
 * from, so the letters here are by construction the letters printed there. Nothing
 * re-derives the shuffle; a key that computed its own layout could silently drift
 * from the paper on any change to the seeding.
 *
 * Carries only what a student needs to score themselves: the position, the letters,
 * and the question as it was printed. Nothing about where a position came from in
 * the bank — this document gets posted.
 */
export async function buildPracticeKey(
  examId: string,
  options: { variantLabel?: string } = {},
): Promise<{ key: PracticeKey; variantCount: number }> {
  const ctx = await loadPracticeContext(examId, options)

  const variants: KeyVariant[] = ctx.papers.map(({ label, layout }) => ({
    label,
    traceCode: layout.traceCode,
    entries: layout.entries
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((entry): KeyEntry => ({
        position: entry.position,
        points: entry.points,
        correctLetters: entry.correctLetters,
        promptHtml: ctx.promptHtml.get(entry.runVariationId) ?? '',
        choices: entry.choiceOrder.map((choiceId, i) => ({
          letter: LETTERS[i],
          html: ctx.choiceHtml.get(choiceId) ?? '',
          // Read off the layout rather than re-checked against the authoring row:
          // `correctLetters` is already expressed in this variant's shuffled order,
          // which is the order these choices print in.
          correct: entry.correctLetters.includes(LETTERS[i]),
        })),
      })),
  }))

  return {
    key: {
      courseName: ctx.courseName,
      examTitle: ctx.examTitle,
      generatedOn: new Date().toISOString().slice(0, 10),
      variants,
      ...(ctx.extraCredit
        ? {
            extraCredit: {
              position: ctx.extraCredit.position,
              letters: ctx.extraCredit.letters,
              onPaper: ctx.extraCreditOnPaper,
            },
          }
        : {}),
    },
    variantCount: ctx.variantCount,
  }
}

/**
 * Renders the key to PDF.
 *
 * Drives Chromium directly rather than going through `ExamRenderer`, which splices
 * a bubble sheet in front of every paper and pads it to a duplex-safe length. This
 * is a reference document nobody bubbles on, so it wants neither.
 */
export async function renderPracticeKeyPdf(key: PracticeKey): Promise<Uint8Array> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'twister-practice-key-'))
  const browser = await chromium.launch()
  try {
    await stageKatex(workDir)
    const shellPath = path.join(workDir, 'shell.html')
    await writeFile(shellPath, buildKeyShell('katex.min.css'), 'utf8')

    const page = await browser.newPage()
    await page.goto(pathToFileURL(shellPath).href, { waitUntil: 'load' })
    await page.evaluate((html) => {
      document.body.innerHTML = html
    }, buildKeyBody(key))
    await page.evaluate(() => document.fonts.ready)

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: keyFooter(key),
      margin: { top: '0.6in', bottom: '0.75in', left: '0.7in', right: '0.7in' },
    })
    return new Uint8Array(pdf)
  } finally {
    await browser.close()
    await rm(workDir, { recursive: true, force: true })
  }
}

/** Builds and renders in one call, for the download route. */
export async function buildPracticeKeyPdf(
  examId: string,
  options: { variantLabel?: string } = {},
): Promise<PracticeKeyResult> {
  const { key, variantCount } = await buildPracticeKey(examId, options)
  return {
    pdf: await renderPracticeKeyPdf(key),
    examTitle: key.examTitle,
    variantCount,
    variantLabel: options.variantLabel,
  }
}

/** Filesystem-safe name for the downloaded file. */
export function practiceKeyFileName(examTitle: string, variantLabel?: string): string {
  const slug = examTitle
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const suffix = variantLabel ? `-${variantLabel}` : ''
  return `${slug || 'exam'}-practice-key${suffix}.pdf`
}
