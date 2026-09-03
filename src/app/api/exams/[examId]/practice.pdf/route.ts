import { authorizeExamApi } from '@/lib/authorization'
import { buildPracticeExamPdf, practiceExamFileName } from '@/lib/practice-exam'

/**
 * One PDF covering every variant combination of a practice exam — no roster, no
 * generation run, and no answer key persisted, since these papers are never
 * graded. Rendered on demand from the live authoring content, like the question
 * bank download.
 */
export async function GET(request: Request, { params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params
  if (!(await authorizeExamApi(examId, 'exam:generate'))) return new Response('Not found', { status: 404 })

  const name = new URL(request.url).searchParams.get('name') ?? ''

  let result: Awaited<ReturnType<typeof buildPracticeExamPdf>>
  try {
    result = await buildPracticeExamPdf(examId, name)
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 400 })
  }

  return new Response(result.pdf as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(result.pdf.byteLength),
      'content-disposition': `attachment; filename="${practiceExamFileName(result.examTitle)}"`,
      'cache-control': 'no-store, private',
    },
  })
}
