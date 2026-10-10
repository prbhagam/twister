import { authorizeRunApi } from '@/lib/authorization'
import { loadRunStats } from '@/lib/stats-data'
import { itemAnalysisCsv } from '@/lib/stats-report'

/** Per-question and per-variation statistics. Aggregate only; no student data. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  if (!await authorizeRunApi(runId, 'grade:view')) return new Response('Not found', { status: 404 })
  const { stats } = await loadRunStats(runId)
  if (!stats.percent) return new Response('This run has no graded students.', { status: 404 })

  return new Response(itemAnalysisCsv(stats), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="item-analysis-${runId}.csv"`,
    },
  })
}
