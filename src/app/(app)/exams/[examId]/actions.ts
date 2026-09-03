'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { createRun, executeRun } from '@/lib/generation'
import { parseQuestionCsv } from '@/lib/questions-csv'
import { MAX_CHOICES } from '@/lib/seed'
import { audit } from '@/lib/audit'
import { requireExamPermission } from '@/lib/authorization'
import { hasBlockingErrors, validateExam } from '@/lib/exam-validation'

const QUESTION_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'RETIRED'] as const
type QuestionStatus = (typeof QUESTION_STATUSES)[number]

async function nextQuestionOrder(examId: string): Promise<number> {
  const last = await prisma.question.findFirst({ where: { examId }, orderBy: { order: 'desc' } })
  return (last?.order ?? 0) + 1
}

export async function addQuestion(formData: FormData) {
  const examId = String(formData.get('examId'))
  const user = await requireExamPermission(examId, 'question:edit')

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
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } })
  await audit({ actorUserId: user.id, action: 'question.created', entityType: 'question', entityId: question.id, courseId: exam.courseId })

  redirect(`/exams/${examId}/questions/${question.id}`)
}

export async function deleteQuestion(formData: FormData) {
  const question = await prisma.question.findUniqueOrThrow({ where: { id: String(formData.get('questionId')) } })
  const user = await requireExamPermission(question.examId, 'question:edit')
  await prisma.question.update({ where: { id: question.id }, data: { archivedAt: new Date(), workflowStatus: 'RETIRED' } })
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: question.examId } })
  await audit({ actorUserId: user.id, action: 'question.archived', entityType: 'question', entityId: question.id, courseId: exam.courseId })

  // Close the gap so question numbers stay contiguous.
  const remaining = await prisma.question.findMany({
    where: { examId: question.examId, archivedAt: null },
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
  await requireExamPermission(question.examId, 'question:edit')
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

/** Approval is deliberately server-side and only available to course managers.
 * Imported questions remain DRAFT until their complete bank validates. */
export async function approveAllQuestions(formData: FormData) {
  const examId = String(formData.get('examId'))
  const user = await requireExamPermission(examId, 'course:manage')
  const exam = await prisma.exam.findUniqueOrThrow({
    where: { id: examId },
    include: {
      questions: {
        where: { archivedAt: null },
        orderBy: { order: 'asc' },
        include: { variations: { include: { choices: true } } },
      },
    },
  })
  if (hasBlockingErrors(validateExam(exam))) return

  const now = new Date()
  await prisma.question.updateMany({
    where: { examId, archivedAt: null },
    data: { workflowStatus: 'APPROVED', statusChangedAt: now, statusChangedById: user.id },
  })
  await audit({ actorUserId: user.id, action: 'questions.approved', entityType: 'exam', entityId: examId, courseId: exam.courseId, metadata: { count: exam.questions.length } })
  revalidatePath(`/exams/${examId}`)
}

/** Move a single question through the review workflow. */
export async function transitionQuestionStatus(formData: FormData) {
  const questionId = String(formData.get('questionId'))
  const examId = String(formData.get('examId'))
  const status = String(formData.get('status')) as QuestionStatus
  if (!QUESTION_STATUSES.includes(status)) return

  const question = await prisma.question.findUniqueOrThrow({
    where: { id: questionId }, include: { variations: { include: { choices: true } } },
  })
  if (question.examId !== examId || question.archivedAt) return
  const user = await requireExamPermission(examId, 'question:edit')

  // Editors can draft and submit for review. Approval and retirement are a
  // course-manager decision; server-side enforcement does not rely on the UI.
  if ((status === 'APPROVED' || status === 'RETIRED') && user.role !== 'OWNER' && user.role !== 'INSTRUCTOR') return
  if (status === 'APPROVED' && hasBlockingErrors(validateExam({ instructorSeed: 'validated-per-question', questions: [question] }))) return

  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } })
  await prisma.question.update({
    where: { id: questionId },
    data: {
      workflowStatus: status,
      statusChangedAt: new Date(),
      statusChangedById: user.id,
      ...(status === 'RETIRED' ? { archivedAt: new Date() } : {}),
    },
  })
  await audit({ actorUserId: user.id, action: `question.status_${status.toLowerCase()}`, entityType: 'question', entityId: questionId, courseId: exam.courseId })
  revalidatePath(`/exams/${examId}`)
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
  const user = await requireExamPermission(examId, 'question:edit')
  const questionId = formData.get('questionId') ? String(formData.get('questionId')) : null
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) return { errors: ['Choose a CSV to upload.'] }

  // The per-question format has no allow_multiple column of its own — it inherits
  // whatever is already set on the question, from the editor's toggle.
  let existingQuestion: { examId: string; allowMultipleCorrect: boolean } | null = null
  if (questionId) {
    existingQuestion = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      select: { examId: true, allowMultipleCorrect: true },
    })
    if (existingQuestion.examId !== examId) return { errors: ['Question does not belong to this exam.'] }
  }

  const result = parseQuestionCsv(await file.text(), {
    allowMultipleCorrect: existingQuestion?.allowMultipleCorrect,
  })
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
    const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } })
    await audit({ actorUserId: user.id, action: 'question.edited', entityType: 'question', entityId: questionId, courseId: exam.courseId })

    revalidatePath(`/exams/${examId}/questions/${questionId}`)
    return {
      ok: true,
      message: `Imported ${result.questions[0].variations.length} variation(s).`,
      warnings: result.warnings,
    }
  }

  await prisma.question.updateMany({ where: { examId, archivedAt: null }, data: { archivedAt: new Date(), workflowStatus: 'RETIRED' } })
  for (const [index, question] of result.questions.entries()) {
    const created = await prisma.question.create({
      data: {
        examId,
        order: question.questionNumber ?? index + 1,
        points: question.points ?? 1,
        allowMultipleCorrect: question.allowMultipleCorrect ?? false,
      },
    })
    await Promise.all(writeVariations(created.id, question))
  }
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } })
  await audit({ actorUserId: user.id, action: 'questions.imported', entityType: 'exam', entityId: examId, courseId: exam.courseId, metadata: { questions: result.questions.length } })

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
  const user = await requireExamPermission(examId, 'exam:generate')
  const sections = formData.getAll('sections').map(String).filter(Boolean)
  const label = String(formData.get('label') ?? '').trim() || undefined

  let runId: string
  try {
    const target = await prisma.exam.findUniqueOrThrow({ where: { id: examId }, select: { isPracticeExam: true } })
    if (target.isPracticeExam) {
      return { error: 'This exam is marked as a practice exam — generate practice papers instead of a roster run.' }
    }
    const unapproved = await prisma.question.count({ where: { examId, archivedAt: null, workflowStatus: { not: 'APPROVED' } } })
    if (unapproved) return { error: `${unapproved} question(s) are not approved.` }
    ;({ runId } = await createRun({ examId, sections, label }))
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } })
  await prisma.exam.update({ where: { id: examId }, data: { lifecycle: 'GENERATED' } })
  await audit({ actorUserId: user.id, action: 'exam.generation_started', entityType: 'generation_run', entityId: runId, courseId: exam.courseId })

  // Rendering hundreds of PDFs takes minutes; it runs detached and the run page
  // polls completedCount rather than holding this request open.
  void executeRun(runId).catch((error) => {
    console.error(`[twister] generation run ${runId} failed:`, error)
  })

  redirect(`/runs/${runId}`)
}
