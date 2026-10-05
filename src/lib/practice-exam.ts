import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { prisma } from './db'
import { hasBlockingErrors, validateExam } from './exam-validation'
import { renderMarkdown } from './markdown'
import type { RenderExam } from './pdf/exam-html'
import { ExamRenderer, stageRenderAssets } from './pdf/renderer'
import { readExtraCredit, type ExtraCredit } from './extra-credit'
import { buildLayout, type ExamLayout, type SeedQuestion } from './seed'

export interface PracticeExamPdf {
  pdf: Uint8Array
  examTitle: string
  variantCount: number
  /** Set when the PDF is a single variant rather than every variant merged. */
  variantLabel?: string
}

/**
 * A random 9-digit sample ID, cosmetic only. It fills the bubble sheet's ID box so a
 * practice paper looks like a real one, but nothing is ever seeded from it — it is
 * never derived from, or matched against, a real student's GT ID.
 */
function sampleGtId(): string {
  let digits = '9'
  for (let i = 0; i < 8; i++) digits += Math.floor(Math.random() * 10)
  return digits
}

/**
 * The label shown for each variant slot — "A", "B", … as authored on the first
 * question, falling back to "1", "2", … if a label is blank. Every question is
 * required to carry the same number of variations, so the first question's labels
 * stand in for the whole exam.
 */
export function practiceVariantLabels(firstQuestionVariations: { label: string }[]): string[] {
  return firstQuestionVariations.map((v, i) => v.label || String(i + 1))
}

/**
 * Renders one variant combination of a practice exam — all of question 1's
 * variation A with all of question 2's variation A, and so on — or, with no
 * `variantLabel`, every variant merged into one document.
 *
 * Unlike a real generation run, this reads the live authoring content directly and
 * freezes nothing: there is no roster, no grading, and no answer key to keep in
 * sync, so the practice PDF should always reflect whatever is on the exam right now.
 */
/** One variant's paper: the label it prints under, and the layout behind it. */
export interface PracticeVariantPaper {
  label: string
  layout: ExamLayout
}

/**
 * Everything a practice paper and its answer key are both built from.
 *
 * Shared deliberately rather than computed twice. A key is only a key because its
 * letters are the ones on the paper, and that holds only if both come from the same
 * `buildLayout` call against the same content with the same seed. Deriving the two
 * from one context makes that structural, instead of two code paths that have to be
 * kept in step by hand.
 */
export interface PracticeContext {
  examTitle: string
  courseName: string
  instructionsHtml?: string
  /** Printed at the back of the paper, only when the exam asked for it. */
  printedExtraCredit: ExtraCredit | null
  /** Configured at all. The key reports it either way, since it grades either way. */
  extraCredit: ExtraCredit | null
  extraCreditOnPaper: boolean
  labels: string[]
  variantCount: number
  /** Only the variants this request asked for. */
  papers: PracticeVariantPaper[]
  /** variation.id -> rendered prompt. */
  promptHtml: Map<string, string>
  /** choice.id -> rendered choice text. */
  choiceHtml: Map<string, string>
}

/**
 * Loads the live exam, validates it, and lays out the requested variants.
 *
 * Reads the authoring side and freezes nothing: there is no roster, no grading and
 * no stored answer key, so a practice paper and its key should always reflect
 * whatever is on the exam right now.
 */
export async function loadPracticeContext(
  examId: string,
  options: { variantLabel?: string } = {},
): Promise<PracticeContext> {
  const exam = await prisma.exam.findUniqueOrThrow({
    where: { id: examId },
    include: {
      course: true,
      questions: {
        where: { archivedAt: null },
        orderBy: { order: 'asc' },
        include: {
          variations: { orderBy: { order: 'asc' }, include: { choices: { orderBy: { order: 'asc' } } } },
        },
      },
    },
  })

  if (!exam.isPracticeExam) {
    throw new Error('This exam is not marked as a practice exam.')
  }

  const issues = validateExam(exam)
  if (hasBlockingErrors(issues)) {
    throw new Error(
      `Exam has ${issues.filter((i) => i.level === 'error').length} blocking issue(s):\n` +
        issues
          .filter((i) => i.level === 'error')
          .map((i) => `  \u2022 ${i.message}`)
          .join('\n'),
    )
  }

  // validateExam already blocks uneven counts once isPracticeExam is set, so this is
  // safe to read directly.
  const labels = practiceVariantLabels(exam.questions[0]?.variations ?? [])
  const variantCount = labels.length

  let selectedIndices: number[]
  if (options.variantLabel !== undefined) {
    const index = labels.indexOf(options.variantLabel)
    if (index === -1) {
      throw new Error(`This exam has no variant "${options.variantLabel}".`)
    }
    selectedIndices = [index]
  } else {
    selectedIndices = labels.map((_, i) => i)
  }

  const promptHtml = new Map<string, string>()
  const choiceHtml = new Map<string, string>()
  await Promise.all([
    ...exam.questions.flatMap((q) =>
      q.variations.map(async (v) => {
        promptHtml.set(v.id, await renderMarkdown(v.promptMarkdown))
      }),
    ),
    ...exam.questions.flatMap((q) =>
      q.variations.flatMap((v) =>
        v.choices.map(async (c) => {
          choiceHtml.set(c.id, await renderMarkdown(c.textMarkdown))
        }),
      ),
    ),
  ])

  const seedQuestions: SeedQuestion[] = exam.questions.map((q) => ({
    key: q.id,
    refId: q.id,
    points: q.points,
    variations: q.variations.map((v) => ({
      refId: v.id,
      choices: v.choices.map((c) => ({ refId: c.id, isCorrect: c.isCorrect, pinToLast: c.pinToLast })),
    })),
  }))

  const papers: PracticeVariantPaper[] = selectedIndices.map((i) => {
    const label = labels[i]
    return {
      label,
      layout: buildLayout({
        instructorSeed: exam.instructorSeed,
        examId: exam.id,
        // Seeds the choice/question shuffle only \u2014 never printed, never matched
        // against a real identity. Distinct per variant so regenerating the same
        // exam always reproduces the same set of practice papers.
        gtId: `practice:${label}`,
        questions: seedQuestions,
        forcedVariantIndex: i,
      }),
    }
  })

  return {
    examTitle: exam.title,
    courseName: [exam.course.name, exam.course.title].filter(Boolean).join(' \u2014 '),
    instructionsHtml: exam.instructions ? await renderMarkdown(exam.instructions) : undefined,
    printedExtraCredit: exam.extraCreditOnPaper ? readExtraCredit(exam) : null,
    extraCredit: readExtraCredit(exam),
    extraCreditOnPaper: exam.extraCreditOnPaper,
    labels,
    variantCount,
    papers,
    promptHtml,
    choiceHtml,
  }
}

/**
 * Renders one variant combination of a practice exam \u2014 all of question 1's
 * variation A with all of question 2's variation A, and so on \u2014 or, with no
 * `variantLabel`, every variant merged into one document.
 */
export async function buildPracticeExamPdf(
  examId: string,
  studentName: string,
  options: { variantLabel?: string } = {},
): Promise<PracticeExamPdf> {
  const ctx = await loadPracticeContext(examId, options)

  // One sample ID for the whole batch \u2014 these are all "the same" sample student,
  // just sitting a different variant of the paper.
  const gtId = sampleGtId()
  const name = studentName.trim() || 'Practice Exam'

  const workDir = await mkdtemp(path.join(tmpdir(), 'twister-practice-'))
  let renderer: ExamRenderer | undefined
  try {
    const shellPath = await stageRenderAssets(workDir)
    renderer = await ExamRenderer.launch({ shellPath })

    const merged = await PDFDocument.create()
    for (const { label, layout } of ctx.papers) {
      const renderExam: RenderExam = {
        // The letter marks the exam itself ("Practice Exam A"), not the sample
        // student, since every variant is nominally sat by the same person.
        examTitle: `${ctx.examTitle} ${label}`,
        courseName: ctx.courseName,
        studentName: name,
        gtId,
        traceCode: layout.traceCode,
        instructionsHtml: ctx.instructionsHtml,
        extraCredit: ctx.printedExtraCredit ?? undefined,
        katexHref: 'katex.min.css',
        questions: layout.entries
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((entry) => ({
            position: entry.position,
            points: entry.points,
            promptHtml: ctx.promptHtml.get(entry.runVariationId) ?? '',
            choicesHtml: entry.choiceOrder.map((id) => ctx.choiceHtml.get(id) ?? ''),
          })),
      }

      const { pdf } = await renderer.render(renderExam)
      const doc = await PDFDocument.load(pdf)
      const pages = await merged.copyPages(doc, doc.getPageIndices())
      for (const page of pages) merged.addPage(page)
    }

    return {
      pdf: await merged.save(),
      examTitle: ctx.examTitle,
      variantCount: ctx.variantCount,
      variantLabel: options.variantLabel,
    }
  } finally {
    await renderer?.close()
    await rm(workDir, { recursive: true, force: true })
  }
}

/** Filesystem-safe name for the downloaded file. */
export function practiceExamFileName(examTitle: string, variantLabel?: string): string {
  const slug = examTitle
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  const suffix = variantLabel ? `-${variantLabel}` : ''
  return `${slug || 'exam'}-practice${suffix}.pdf`
}
