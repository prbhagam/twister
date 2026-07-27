import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { Button, Card, CardHeader } from '@/components/ui'
import { deleteQuestion } from '../../actions'
import { CsvImport } from '../../CsvImport'
import { QuestionEditor } from './QuestionEditor'

export const dynamic = 'force-dynamic'

export default async function QuestionPage({
  params,
}: {
  params: Promise<{ examId: string; questionId: string }>
}) {
  const { examId, questionId } = await params

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: {
      exam: true,
      variations: { orderBy: { order: 'asc' }, include: { choices: { orderBy: { order: 'asc' } } } },
    },
  })
  if (!question || question.examId !== examId) notFound()

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/exams/${examId}`} className="text-xs text-slate-500 hover:underline">
            ← {question.exam.title}
          </Link>
          <h1 className="mt-1 text-lg font-semibold">Question {question.order}</h1>
        </div>
        <form action={deleteQuestion}>
          <input type="hidden" name="questionId" value={question.id} />
          <Button type="submit" variant="danger">
            Delete question
          </Button>
        </form>
      </div>

      <QuestionEditor
        examId={examId}
        questionId={question.id}
        order={question.order}
        initialPoints={question.points}
        initialTitle={question.title ?? ''}
        initialVariations={question.variations.map((variation) => ({
          label: variation.label,
          promptMarkdown: variation.promptMarkdown,
          choices: variation.choices.map((choice) => ({
            textMarkdown: choice.textMarkdown,
            isCorrect: choice.isCorrect,
            pinToLast: choice.pinToLast,
          })),
        }))}
      />

      <Card>
        <CardHeader
          title="Import variations from CSV"
          subtitle="Replaces every variation on this question"
          action={
            <a
              href="/api/questions-template.csv"
              className="text-xs text-slate-600 underline hover:text-slate-900"
            >
              Download template
            </a>
          }
        />
        <div className="px-5 py-4">
          <CsvImport
            examId={examId}
            questionId={question.id}
            hint="One row per variation: variation_label, prompt, choice_1…choice_5, correct (1-based index), pin_last (space-separated indices). Leave trailing choice columns blank for fewer than 5 options."
          />
        </div>
      </Card>
    </div>
  )
}
