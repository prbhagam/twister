'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { createRun, executeRun } from '@/lib/generation'
import { parseQuestionCsv } from '@/lib/questions-csv'
import { MAX_CHOICES } from '@/lib/seed'

async function nextQuestionOrder(examId: string): Promise<number> {
  const last = await prisma.question.findFirst({ where: { examId }, orderBy: { order: 'desc' } })
  return (last?.order ?? 0) + 1
}

export async function addQuestion(formData: FormData) {
  const examId = String(formData.get('examId'))

  // A new question starts with one variation and five blank choices so the editor
  // opens on something editable rather than an empty shell.
  const question = await prisma.question.create({
    data: {
      examId,
      order: await nextQuestionOrder(examId),
      points: 1,
      variations: {
        create: {
          order: 0,
          label: 'A',
          promptMarkdown: '',
          choices: {
            create: Array.from({ length: MAX_CHOICES }, (_, i) => ({
              order: i,
              textMarkdown: '',
              isCorrect: i === 0,
              pinToLast: false,
            })),
          },
        },
      },
    },
  })

  redirect(`/exams/${examId}/questions/${question.id}`)
}

export async function deleteQuestion(formData: FormData) {
  const question = await prisma.question.delete({
    where: { id: String(formData.get('questionId')) },
  })

  // Close the gap so question numbers stay contiguous.
  const remaining = await prisma.question.findMany({
    where: { examId: question.examId },
    orderBy: { order: 'asc' },
  })
  await Promise.all(
    remaining.map((q, i) => prisma.question.update({ where: { id: q.id }, data: { order: i + 1 } })),
  )

  revalidatePath(`/exams/${question.examId}`)
  redirect(`/exams/${question.examId}`)
}

export async function moveQuestion(formData: FormData) {
  const questionId = String(formData.get('questionId'))
  const direction = String(formData.get('direction')) === 'up' ? -1 : 1

  const question = await prisma.question.findUniqueOrThrow({ where: { id: questionId } })
  const neighbour = await prisma.question.findFirst({
    where: {
      examId: question.examId,
      order: direction === -1 ? { lt: question.order } : { gt: question.order },
    },
    orderBy: { order: direction === -1 ? 'desc' : 'asc' },
  })
  if (!neighbour) return

  await prisma.$transaction([
    prisma.question.update({ where: { id: question.id }, data: { order: neighbour.order } }),
    prisma.question.update({ where: { id: neighbour.id }, data: { order: question.order } }),
  ])

  revalidatePath(`/exams/${question.examId}`)
}

export interface CsvImportState {
  ok?: boolean
  message?: string
  errors?: string[]
  warnings?: string[]
}

/**
 * Imports variations from CSV. Accepts both the per-question format and the
 * whole-exam format; the whole-exam format replaces the entire question list.
 */
export async function importQuestionCsv(
  _prev: CsvImportState,
  formData: FormData,
): Promise<CsvImportState> {
  const examId = String(formData.get('examId'))
  const questionId = formData.get('questionId') ? String(formData.get('questionId')) : null
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) return { errors: ['Choose a CSV to upload.'] }

  const result = parseQuestionCsv(await file.text())
  if (result.errors.length) return { errors: result.errors, warnings: result.warnings }
  if (result.questions.length === 0) return { errors: ['No question rows found in that CSV.'] }

  const writeVariations = (targetId: string, question: (typeof result.questions)[number]) =>
    question.variations.map((variation, v) =>
      prisma.variation.create({
        data: {
          questionId: targetId,
          order: v,
          label: variation.label,
          promptMarkdown: variation.promptMarkdown,
          choices: {
            create: variation.choices.map((choice, c) => ({
              order: c,
              textMarkdown: choice.textMarkdown,
              isCorrect: choice.isCorrect,
              pinToLast: choice.pinToLast,
            })),
          },
        },
      }),
    )

  if (questionId) {
    if (result.questions.length > 1) {
      return {
        errors: [
          `That CSV describes ${result.questions.length} questions. Upload it from the exam page to replace the whole question list, or remove the question_number column.`,
        ],
      }
    }
    // Replacing rather than appending: re-uploading a corrected file should not
    // leave the old variations behind.
    await prisma.variation.deleteMany({ where: { questionId } })
    await Promise.all(writeVariations(questionId, result.questions[0]))

    revalidatePath(`/exams/${examId}/questions/${questionId}`)
    return {
      ok: true,
      message: `Imported ${result.questions[0].variations.length} variation(s).`,
      warnings: result.warnings,
    }
  }

  await prisma.question.deleteMany({ where: { examId } })
  for (const [index, question] of result.questions.entries()) {
    const created = await prisma.question.create({
      data: {
        examId,
        order: question.questionNumber ?? index + 1,
        points: question.points ?? 1,
      },
    })
    await Promise.all(writeVariations(created.id, question))
  }

  revalidatePath(`/exams/${examId}`)
  return {
    ok: true,
    message: `Imported ${result.questions.length} questions with ${result.questions.reduce((n, q) => n + q.variations.length, 0)} variations.`,
    warnings: result.warnings,
  }
}

export interface GenerateState {
  error?: string
  runId?: string
}

export async function startGeneration(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const examId = String(formData.get('examId'))
  const sections = formData.getAll('sections').map(String).filter(Boolean)
  const label = String(formData.get('label') ?? '').trim() || undefined

  let runId: string
  try {
    ;({ runId } = await createRun({ examId, sections, label }))
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  // Rendering hundreds of PDFs takes minutes; it runs detached and the run page
  // polls completedCount rather than holding this request open.
  void executeRun(runId).catch((error) => {
    console.error(`[twister] generation run ${runId} failed:`, error)
  })

  redirect(`/runs/${runId}`)
}
