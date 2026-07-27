import { scoresCsv } from '@/lib/export'
import { loadScoreRows } from '@/lib/run-data'
import { authorizeRunApi } from '@/lib/authorization'

/** Gradebook export, alphabetical by last name. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  if (!await authorizeRunApi(runId, 'export:grades')) return new Response('Not found', { status: 404 })
  const { rows } = await loadScoreRows(runId)
  if (rows.length === 0) return new Response('Not found', { status: 404 })

  return new Response(scoresCsv(rows), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="scores-${runId}.csv"`,
    },
  })
}
