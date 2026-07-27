import { prisma } from '@/lib/db'
import { canvasCsv } from '@/lib/export'
import { loadScoreRows } from '@/lib/run-data'
import { authorizeRunApi } from '@/lib/authorization'

/** Canvas gradebook import shape; matched on SIS User ID (the GT ID). */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  // ?submittedOnly=1 drops students with no scanned sheet instead of marking them.
  const submittedOnly = new URL(request.url).searchParams.get('submittedOnly') === '1'
  if (!await authorizeRunApi(runId, 'export:grades')) return new Response('Not found', { status: 404 })

  const run = await prisma.generationRun.findUnique({ where: { id: runId } })
  if (!run) return new Response('Not found', { status: 404 })

  const { rows } = await loadScoreRows(runId)
  const csv = canvasCsv(rows, run.examTitle || 'Exam', { submittedOnly })

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="canvas-${runId}${submittedOnly ? '-submitted-only' : ''}.csv"`,
    },
  })
}
