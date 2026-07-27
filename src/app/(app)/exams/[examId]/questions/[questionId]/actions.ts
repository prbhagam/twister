'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'

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
    if (variation.choices.filter((c) => c.isCorrect).length !== 1) {
      return { error: `Variation ${variation.label || i + 1} must have exactly one correct answer.` }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.variation.deleteMany({ where: { questionId } })
    await tx.question.update({
      where: { id: questionId },
      data: { points: Number.isFinite(points) && points > 0 ? points : 1, title },
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
  return { ok: true, savedAt: Date.now() }
}
