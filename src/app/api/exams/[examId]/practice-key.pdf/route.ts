import { authorizeExamApi } from '@/lib/authorization'
import { buildPracticeKeyPdf, practiceKeyFileName } from '@/lib/practice-key'

/**
 * The answer key for a practice exam's variants: a grid of question number to
 * correct letter, then every question with the right choice marked.
 *
 * A student handout, posted next to the practice paper so people can score
 * themselves. So it is gated the same as the practice paper (`exam:generate`) and
 * not as the question-bank download (`question:edit`) — whoever can hand out the
 * paper can hand out its answers, and there is nothing here that is not meant to
 * be public.
 *
 * With a `variant` query param, returns just that variant's key; with none, every
 * variant, one per page-break. Rendered on demand from the live questions through
 * the same layout the paper is built from, so the letters always agree with a
 * paper downloaded at the same moment.
 */
export async function GET(request: Request, { params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params
  if (!(await authorizeExamApi(examId, 'exam:generate'))) return new Response('Not found', { status: 404 })

  const variantLabel = new URL(request.url).searchParams.get('variant') || undefined

  let result: Awaited<ReturnType<typeof buildPracticeKeyPdf>>
  try {
    result = await buildPracticeKeyPdf(examId, { variantLabel })
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 400 })
  }

  return new Response(result.pdf as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(result.pdf.byteLength),
      'content-disposition': `attachment; filename="${practiceKeyFileName(result.examTitle, result.variantLabel)}"`,
      // Matches the practice paper: served fresh from the live questions, so a
      // cached copy could disagree with the paper downloaded beside it.
      'cache-control': 'no-store, private',
    },
  })
}
