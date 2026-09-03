import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { prisma } from './db'
import { hasBlockingErrors, validateExam } from './exam-validation'
import { renderMarkdown } from './markdown'
import type { RenderExam } from './pdf/exam-html'
import { ExamRenderer, stageRenderAssets } from './pdf/renderer'
import { buildLayout, type SeedQuestion } from './seed'

export interface PracticeExamPdf {
  pdf: Uint8Array
  examTitle: string
  variantCount: number
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
 * Renders one PDF per variant combination — all of question 1's variation A with
 * all of question 2's variation A, and so on — merged into a single document.
 *
 * Unlike a real generation run, this reads the live authoring content directly and
 * freezes nothing: there is no roster, no grading, and no answer key to keep in
 * sync, so the practice PDF should always reflect whatever is on the exam right now.
 */
export async function buildPracticeExamPdf(examId: string, studentName: string): Promise<PracticeExamPdf> {
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
          .map((i) => `  • ${i.message}`)
          .join('\n'),
    )
  }

  // validateExam already blocks uneven counts once isPracticeExam is set, so this is
  // safe to read directly.
  const variantCount = exam.questions[0]?.variations.length ?? 0

  const renderedPrompts = new Map<string, string>()
  const renderedChoices = new Map<string, string>()
  await Promise.all([
    ...exam.questions.flatMap((q) =>
      q.variations.map(async (v) => {
        renderedPrompts.set(v.id, await renderMarkdown(v.promptMarkdown))
      }),
    ),
    ...exam.questions.flatMap((q) =>
      q.variations.flatMap((v) =>
        v.choices.map(async (c) => {
          renderedChoices.set(c.id, await renderMarkdown(c.textMarkdown))
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

  const instructionsHtml = exam.instructions ? await renderMarkdown(exam.instructions) : undefined
  const courseName = [exam.course.name, exam.course.title].filter(Boolean).join(' — ')
  // One sample ID for the whole batch — these are all "the same" sample student,
  // just sitting a different variant of the paper.
  const gtId = sampleGtId()
  const name = studentName.trim() || 'Practice Exam'

  const workDir = await mkdtemp(path.join(tmpdir(), 'twister-practice-'))
  let renderer: ExamRenderer | undefined
  try {
    const shellPath = await stageRenderAssets(workDir)
    renderer = await ExamRenderer.launch({ shellPath })

    const merged = await PDFDocument.create()
    for (let i = 0; i < variantCount; i++) {
      const label = exam.questions[0]?.variations[i]?.label || String(i + 1)

      const layout = buildLayout({
        instructorSeed: exam.instructorSeed,
        examId: exam.id,
        // Seeds the choice/question shuffle only — never printed, never matched
        // against a real identity. Distinct per variant so regenerating the same
        // exam always reproduces the same set of practice papers.
        gtId: `practice:${label}`,
        questions: seedQuestions,
        forcedVariantIndex: i,
      })

      const renderExam: RenderExam = {
        // The letter marks the exam itself ("Practice Exam A"), not the sample
        // student, since every variant is nominally sat by the same person.
        examTitle: `${exam.title} ${label}`,
        courseName,
        studentName: name,
        gtId,
        traceCode: layout.traceCode,
        instructionsHtml,
        katexHref: 'katex.min.css',
        questions: layout.entries
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((entry) => ({
            position: entry.position,
            points: entry.points,
            promptHtml: renderedPrompts.get(entry.runVariationId) ?? '',
            choicesHtml: entry.choiceOrder.map((id) => renderedChoices.get(id) ?? ''),
          })),
      }

      const { pdf } = await renderer.render(renderExam)
      const doc = await PDFDocument.load(pdf)
      const pages = await merged.copyPages(doc, doc.getPageIndices())
      for (const page of pages) merged.addPage(page)
    }

    return { pdf: await merged.save(), examTitle: exam.title, variantCount }
  } finally {
    await renderer?.close()
    await rm(workDir, { recursive: true, force: true })
  }
}

/** Filesystem-safe name for the downloaded file. */
export function practiceExamFileName(examTitle: string): string {
  const slug = examTitle
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'exam'}-practice.pdf`
}
