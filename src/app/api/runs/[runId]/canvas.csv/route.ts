import { prisma } from '@/lib/db'
import { canvasCsv } from '@/lib/export'
import { loadScoreRows } from '@/lib/run-data'

/** Canvas gradebook import shape; matched on SIS User ID (the GT ID). */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params

  const run = await prisma.generationRun.findUnique({ where: { id: runId } })
  if (!run) return new Response('Not found', { status: 404 })

  const { rows } = await loadScoreRows(runId)
  const csv = canvasCsv(rows, run.examTitle || 'Exam')

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="canvas-${runId}.csv"`,
    },
  })
}
