import { authorizeExamApi } from '@/lib/authorization'
import { buildQuestionBank, questionBankFileName, renderQuestionBankPdf } from '@/lib/question-bank'

/**
 * The whole question bank as one PDF: every question, every variation, every
 * choice, with the correct answers marked.
 *
 * This is an instructor document — it is a complete answer key for every paper the
 * exam can produce — so it is gated on `question:edit` rather than plain course
 * viewing, and rendered on demand rather than written into the run output
 * directory, which is served for printing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params
  if (!(await authorizeExamApi(examId, 'question:edit'))) return new Response('Not found', { status: 404 })

  const bank = await buildQuestionBank(examId)
  if (!bank) return new Response('Not found', { status: 404 })

  const pdf = await renderQuestionBankPdf(bank)
  return new Response(pdf as BodyInit, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(pdf.byteLength),
      'content-disposition': `attachment; filename="${questionBankFileName(bank.examTitle)}"`,
      // An answer key must never sit in a shared cache.
      'cache-control': 'no-store, private',
    },
  })
}
