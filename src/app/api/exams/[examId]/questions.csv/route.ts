import { prisma } from '@/lib/db'
import { toQuestionCsv } from '@/lib/questions-csv'

/** Round-trips the live question bank so it can be edited in a spreadsheet. */
export async function GET(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      questions: {
        orderBy: { order: 'asc' },
        include: {
          variations: { orderBy: { order: 'asc' }, include: { choices: { orderBy: { order: 'asc' } } } },
        },
      },
    },
  })
  if (!exam) return new Response('Not found', { status: 404 })

  const csv = toQuestionCsv(exam.questions, true)
  const slug = exam.title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'exam'

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${slug}-questions.csv"`,
    },
  })
}
