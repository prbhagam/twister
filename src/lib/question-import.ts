import { prisma } from './db'
import type { ImportedQuestion } from './questions-csv'

/** Creates one imported question's variations, with their choices, under `questionId`. */
export function writeVariations(questionId: string, question: ImportedQuestion) {
  return Promise.all(
    question.variations.map((variation, v) =>
      prisma.variation.create({
        data: {
          questionId,
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
    ),
  )
}

/**
 * Replaces an exam's whole question list with an imported one.
 *
 * The old questions are retired, not deleted: an earlier run's grading still
 * resolves through its own snapshot, and the rows stay for the record. New
 * questions arrive as DRAFT, so generation is blocked until they are reviewed
 * and approved.
 *
 * `versionNames` replaces the exam's list when the CSV had a version_name
 * column (even an empty one, which clears it) and is left alone when it had
 * none — see QuestionCsvResult.versionNames.
 */
export async function replaceExamQuestions(
  examId: string,
  questions: ImportedQuestion[],
  versionNames: string[] | null,
): Promise<void> {
  await prisma.question.updateMany({
    where: { examId, archivedAt: null },
    data: { archivedAt: new Date(), workflowStatus: 'RETIRED' },
  })
  for (const [index, question] of questions.entries()) {
    const created = await prisma.question.create({
      data: {
        examId,
        order: question.questionNumber ?? index + 1,
        points: question.points ?? 1,
        allowMultipleCorrect: question.allowMultipleCorrect ?? false,
      },
    })
    await writeVariations(created.id, question)
  }
  if (versionNames !== null) {
    await prisma.exam.update({ where: { id: examId }, data: { versionNames: JSON.stringify(versionNames) } })
  }
}
