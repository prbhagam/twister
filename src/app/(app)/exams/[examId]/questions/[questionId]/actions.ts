'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { audit } from '@/lib/audit'
import { requireExamPermission } from '@/lib/authorization'

export interface EditableChoice {
  textMarkdown: string
  isCorrect: boolean
  pinToLast: boolean
}

export interface EditableVariation {
  label: string
  promptMarkdown: string
  choices: EditableChoice[]
}

export interface SaveState {
  ok?: boolean
  error?: string
  savedAt?: number
}

/**
 * Replaces a question's variations wholesale from the editor's state.
 *
 * Rewriting rather than diffing is safe here because generation runs hold their own
 * frozen copies — nothing downstream references these ids once an exam is printed.
 */
export async function saveQuestion(_prev: SaveState, formData: FormData): Promise<SaveState> {
  const questionId = String(formData.get('questionId'))
  const examId = String(formData.get('examId'))
  const points = Number(formData.get('points') ?? 1)
  const title = String(formData.get('title') ?? '').trim() || null
  const allowMultipleCorrect = formData.get('allowMultipleCorrect') === 'on'
  const question = await prisma.question.findUniqueOrThrow({ where: { id: questionId } })
  if (question.examId !== examId) return { error: 'Question does not belong to this exam.' }
  const user = await requireExamPermission(examId, 'question:edit')

  let variations: EditableVariation[]
  try {
    variations = JSON.parse(String(formData.get('variations') ?? '[]')) as EditableVariation[]
  } catch {
    return { error: 'Could not read the editor state.' }
  }

  if (variations.length === 0) return { error: 'A question needs at least one variation.' }

  for (const [i, variation] of variations.entries()) {
    if (variation.choices.length < 2) {
      return { error: `Variation ${variation.label || i + 1} needs at least 2 answer choices.` }
    }
    const correctCount = variation.choices.filter((c) => c.isCorrect).length
    if (correctCount === 0) {
      return { error: `Variation ${variation.label || i + 1} needs a correct answer marked.` }
    }
    if (correctCount > 1 && !allowMultipleCorrect) {
      return {
        error: `Variation ${variation.label || i + 1} has more than one correct answer marked, but "select all that apply" is off.`,
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.variation.deleteMany({ where: { questionId } })
    await tx.question.update({
      where: { id: questionId },
      data: { points: Number.isFinite(points) && points > 0 ? points : 1, title, allowMultipleCorrect },
    })
    for (const [v, variation] of variations.entries()) {
      await tx.variation.create({
        data: {
          questionId,
          order: v,
          label: variation.label || String.fromCharCode(65 + v),
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
      })
    }
  })

  revalidatePath(`/exams/${examId}/questions/${questionId}`)
  revalidatePath(`/exams/${examId}`)
  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } })
  await audit({ actorUserId: user.id, action: 'question.edited', entityType: 'question', entityId: questionId, courseId: exam.courseId })
  return { ok: true, savedAt: Date.now() }
}
