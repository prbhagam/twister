import Link from 'next/link'
import type { ExamStats } from '@/lib/stats'
import { scoreHistogramSvg } from '@/lib/stats-charts'
import { CardHeader } from '@/components/ui'
import { InsightList } from './stats/InsightList'

/** How many insights the run page previews before sending you to the full page. */
const PREVIEW = 3

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  )
}

export function StatsSummary({ runId, stats }: { runId: string; stats: ExamStats }) {
  const { percent } = stats
  if (!percent) return null
  const urgent = stats.insights.filter((i) => i.severity === 'critical' || i.severity === 'warning')
  const shown = (urgent.length ? urgent : stats.insights).slice(0, PREVIEW)
  const more = stats.insights.length - shown.length

  return (
    <>
      <CardHeader
        title="Statistics"
        subtitle={`${stats.counts.graded} graded · item analysis across ${stats.items.length} questions`}
        action={
          <Link
            href={`/runs/${runId}/stats`}
            className="shrink-0 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Full statistics →
          </Link>
        }
      />
      <dl className="grid grid-cols-2 gap-3 px-5 pt-4 sm:grid-cols-4">
        <Figure label="Mean" value={`${percent.mean.toFixed(1)}%`} />
        <Figure label="Median" value={`${percent.median.toFixed(1)}%`} />
        <Figure label="Std. dev." value={percent.sd.toFixed(1)} />
        <Figure
          label="Reliability (α)"
          value={stats.reliability && !stats.smallSample ? stats.reliability.alpha.toFixed(2) : '—'}
        />
      </dl>
      <div className="px-5 py-3" dangerouslySetInnerHTML={{ __html: scoreHistogramSvg(stats, { compact: true }) }} />
      {shown.length ? (
        <div className="border-t border-slate-100">
          <InsightList insights={shown} questionHref={(order) => `/runs/${runId}/stats#q-${order}`} />
          {more > 0 ? (
            <Link
              href={`/runs/${runId}/stats`}
              className="block border-t border-slate-100 px-5 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {more} more insight{more === 1 ? '' : 's'} →
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
