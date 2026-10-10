import type { Insight, InsightSeverity } from '@/lib/stats'

/** Icon and label travel with the color, so severity never rests on color alone. */
const SEVERITY: Record<InsightSeverity, { icon: string; label: string; className: string }> = {
  critical: { icon: '!', label: 'Check now', className: 'bg-red-100 text-red-800' },
  warning: { icon: '▲', label: 'Worth a look', className: 'bg-amber-100 text-amber-900' },
  info: { icon: 'i', label: 'Note', className: 'bg-slate-100 text-slate-700' },
  good: { icon: '✓', label: 'Good', className: 'bg-emerald-100 text-emerald-800' },
}

export function InsightList({
  insights,
  questionHref,
}: {
  insights: Insight[]
  /** Builds the link for an insight about one question; omit to render no links. */
  questionHref?: (order: number) => string
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {insights.map((insight, i) => {
        const s = SEVERITY[insight.severity]
        return (
          <li key={i} className="flex gap-3 px-5 py-3">
            <span
              className={`mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium ${s.className}`}
            >
              <span aria-hidden className="font-bold">
                {s.icon}
              </span>
              {s.label}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {insight.question !== undefined && questionHref ? (
                  <a href={questionHref(insight.question)} className="hover:underline">
                    {insight.title}
                  </a>
                ) : (
                  insight.title
                )}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{insight.detail}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
