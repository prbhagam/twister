import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { prisma } from './db'
import { renderMarkdown } from './markdown'
import {
  bankFooter,
  buildBankBody,
  buildBankShell,
  type BankQuestion,
  type QuestionBank,
} from './pdf/question-bank'
import { stageKatex } from './pdf/renderer'

/**
 * Collects the live question bank for one exam: every question, every variation,
 * every choice, in authoring order.
 *
 * Deliberately reads the authoring side rather than a generation run. This is the
 * document you proofread and hand to a co-instructor *before* printing, and it must
 * show what will be generated next, not what some earlier run froze.
 */
export async function buildQuestionBank(examId: string): Promise<QuestionBank | null> {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      course: true,
      questions: {
        where: { archivedAt: null },
        orderBy: { order: 'asc' },
        include: {
          variations: {
            orderBy: { order: 'asc' },
            include: { choices: { orderBy: { order: 'asc' } } },
          },
        },
      },
    },
  })
  if (!exam) return null

  const questions: BankQuestion[] = await Promise.all(
    exam.questions.map(async (question) => ({
      order: question.order,
      title: question.title,
      points: question.points,
      status: question.workflowStatus,
      allowMultipleCorrect: question.allowMultipleCorrect,
      variations: await Promise.all(
        question.variations.map(async (variation) => ({
          label: variation.label,
          promptHtml: await renderMarkdown(variation.promptMarkdown),
          choices: await Promise.all(
            variation.choices.map(async (choice, index) => ({
              number: index + 1,
              html: await renderMarkdown(choice.textMarkdown),
              correct: choice.isCorrect,
              pinToLast: choice.pinToLast,
            })),
          ),
        })),
      ),
    })),
  )

  return {
    courseName: [exam.course.name, exam.course.title].filter(Boolean).join(' — '),
    examTitle: exam.title,
    generatedOn: new Date().toISOString().slice(0, 10),
    questions,
  }
}

/**
 * Renders the bank to a PDF.
 *
 * One document, so this launches Chromium for the request and closes it again —
 * there is no page pool to amortise, unlike the per-student renderers. The KaTeX
 * assets are staged in a temp directory and removed afterwards so a bank download
 * leaves nothing behind in the run output directory.
 */
export async function renderQuestionBankPdf(bank: QuestionBank): Promise<Uint8Array> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'twister-bank-'))
  const browser = await chromium.launch()
  try {
    await stageKatex(workDir)
    const shellPath = path.join(workDir, 'shell.html')
    await writeFile(shellPath, buildBankShell('katex.min.css'), 'utf8')

    const page = await browser.newPage()
    await page.goto(pathToFileURL(shellPath).href, { waitUntil: 'load' })
    await page.evaluate((html) => {
      document.body.innerHTML = html
    }, buildBankBody(bank))
    await page.evaluate(() => document.fonts.ready)

    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: bankFooter(bank),
      margin: { top: '0.6in', bottom: '0.75in', left: '0.7in', right: '0.7in' },
    })
    return new Uint8Array(pdf)
  } finally {
    await browser.close()
    await rm(workDir, { recursive: true, force: true })
  }
}

/** Filesystem-safe name for the downloaded file. */
export function questionBankFileName(examTitle: string): string {
  const slug = examTitle
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'exam'}-question-bank.pdf`
}
