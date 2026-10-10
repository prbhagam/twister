import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AuthorizationError, requireRunPermission } from '@/lib/authorization'
import {
  DISCRIMINATION_FAIR,
  DISCRIMINATION_GOOD,
  EASY_P,
  HARD_P,
  MIN_STUDENTS_FOR_ITEMS,
  formatP,
  type GroupStats,
  type ItemQuality,
  type ItemStats,
  type VariationStats,
} from '@/lib/stats'
import { itemMapSvg, positionLineSvg, scoreHistogramSvg } from '@/lib/stats-charts'
import { loadRunStats } from '@/lib/stats-data'
import { Badge, Card, CardHeader, Empty, Notice } from '@/components/ui'
import { InsightList } from './InsightList'

export const dynamic = 'force-dynamic'

const QUALITY: Record<ItemQuality, { tone: 'green' | 'neutral' | 'amber' | 'red'; label: string }> = {
  good: { tone: 'green', label: 'Good' },
  fair: { tone: 'neutral', label: 'Fair' },
  weak: { tone: 'amber', label: 'Weak' },
  review: { tone: 'red', label: 'Review' },
}

function pct(x: number | null | undefined, digits = 0): string {
  return x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`
}

function num(x: number | null | undefined, digits = 2): string {
  return x === null || x === undefined ? '—' : x.toFixed(digits)
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-0.5 text-xl font-semibold text-slate-900">{value}</p>
      {note ? <p className="mt-0.5 text-[11px] text-slate-500">{note}</p> : null}
    </div>
  )
}

function Chart({ svg }: { svg: string }) {
  return <div className="px-5 py-4" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** A thin magnitude bar for a 0–1 share, in the chart series color. */
function Bar({ value, className = 'w-20' }: { value: number; className?: string }) {
  return (
    <span className={`inline-block h-1.5 rounded-full bg-slate-100 align-middle ${className}`}>
      <span
        className="block h-1.5 rounded-full bg-[#2a78d6]"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </span>
  )
}

function VariationDetail({ item, variation }: { item: ItemStats; variation: VariationStats }) {
  return (
    <div className="rounded-md border border-slate-200">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs">
        <span className="font-semibold text-slate-900">
          {item.variations.length > 1 ? `Variation ${variation.label}` : 'Choices'}
        </span>
        <span className="text-slate-500">
          n={variation.n} · {pct(variation.p)} correct · discrimination {num(variation.discrimination)}
        </span>
        {variation.blank + variation.multi + variation.invalid > 0 ? (
          <span className="text-slate-500">
            {variation.blank} blank · {variation.multi} multiple · {variation.invalid} out of range
          </span>
        ) : null}
      </div>
      {item.variations.length > 1 ? (
        <p className="border-b border-slate-100 px-3 py-1.5 text-xs text-slate-600">{variation.summary}</p>
      ) : null}
      <table className="w-full text-xs">
        <thead className="text-slate-500">
          <tr>
            <th className="w-10 px-3 py-1.5 text-left font-medium">Choice</th>
            <th className="px-2 py-1.5 text-left font-medium">Text</th>
            <th className="px-2 py-1.5 text-left font-medium">{item.multipleCorrect ? 'Marked by' : 'Chosen by'}</th>
            <th className="px-2 py-1.5 text-right font-medium" title="Share of the top 27% of the class who chose it">
              Top 27%
            </th>
            <th className="px-2 py-1.5 text-right font-medium" title="Share of the bottom 27% of the class who chose it">
              Bottom 27%
            </th>
            <th className="px-3 py-1.5 text-right font-medium" title="Average exam score of the students who chose it">
              Their avg
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {variation.choices.map((choice) => {
            const rival = variation.suspectedMiskey?.choiceId === choice.choiceId
            return (
              <tr key={choice.choiceId} className={choice.isCorrect ? 'bg-emerald-50/50' : undefined}>
                <td className="px-3 py-1.5 font-mono font-semibold text-slate-900">{choice.label}</td>
                <td className="px-2 py-1.5 text-slate-700">
                  <span className="mr-1.5">{choice.summary}</span>
                  {choice.isCorrect ? <Badge tone="green">✓ key</Badge> : null}
                  {rival ? <Badge tone="red">! possible key</Badge> : null}
                  {choice.nonFunctional ? <Badge tone="neutral">rarely chosen</Badge> : null}
                  {choice.pinToLast ? <span className="ml-1 text-[11px] text-slate-400">pinned</span> : null}
                </td>
                <td className="whitespace-nowrap px-2 py-1.5">
                  <Bar value={choice.rate} />
                  <span className="ml-2 tabular-nums text-slate-700">{pct(choice.rate)}</span>
                  <span className="ml-1 tabular-nums text-slate-400">({choice.count})</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{pct(choice.upperRate)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-700">{pct(choice.lowerRate)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                  {choice.chooserMean === null ? '—' : `${choice.chooserMean.toFixed(0)}%`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

const ITEM_GRID = 'grid grid-cols-[3rem_minmax(12rem,1fr)_9rem_5rem_5rem_4.5rem_9rem_5rem] items-center gap-x-3'

function ItemRow({ item }: { item: ItemStats }) {
  const quality = QUALITY[item.quality]
  const multi = item.variations.length > 1
  return (
    <details id={`q-${item.order}`} className="group scroll-mt-4 border-b border-slate-100 last:border-b-0 open:bg-slate-50/40">
      <summary className={`${ITEM_GRID} cursor-pointer list-none px-5 py-2 text-sm hover:bg-slate-50`}>
        <span className="font-mono text-xs font-semibold text-slate-900">
          <span className="mr-1 inline-block text-slate-400 transition-transform group-open:rotate-90">›</span>Q{item.order}
        </span>
        <span className="min-w-0 truncate text-slate-700" title={item.summary}>
          {item.title ? <span className="mr-1.5 font-medium text-slate-900">{item.title}</span> : null}
          {item.summary}
          {item.multipleCorrect ? <span className="ml-1.5 text-[11px] text-slate-400">select all</span> : null}
        </span>
        <span className="whitespace-nowrap">
          <Bar value={item.p ?? 0} className="w-14" />
          <span className="ml-2 tabular-nums text-slate-700">{pct(item.p)}</span>
        </span>
        <span className="text-right tabular-nums text-slate-700">{num(item.discrimination)}</span>
        <span className="text-right tabular-nums text-slate-700">{num(item.upperLower)}</span>
        <span className="text-right tabular-nums text-slate-700">{pct(item.blankRate)}</span>
        <span className="truncate text-xs tabular-nums text-slate-600">
          {multi
            ? item.variations.map((v) => `${v.label} ${pct(v.p)}`).join(' · ')
            : '—'}
          {item.variationTest?.significant ? <span className="ml-1 font-semibold text-red-700">!</span> : null}
        </span>
        <span className="text-right">
          <Badge tone={quality.tone}>{quality.label}</Badge>
        </span>
      </summary>
      <div className="space-y-3 px-5 pb-4 pt-1">
        {item.reasons.length ? (
          <p className="text-xs text-red-800">
            <span className="font-semibold">Flagged for review:</span> {item.reasons.join('; ')}.
          </p>
        ) : null}
        {item.variationTest ? (
          <p className="text-xs text-slate-600">
            Variation difficulty spread {pct(item.variationTest.spread)} (χ² = {item.variationTest.chi2.toFixed(2)}, df ={' '}
            {item.variationTest.df}, p = {formatP(item.variationTest.pValue)})
            {item.variationTest.significant ? ' — a real difference, not chance.' : ' — within what chance would produce.'}
          </p>
        ) : null}
        <p className="text-xs text-slate-500">
          {item.n} responses · {item.points} point{item.points === 1 ? '' : 's'} · {pct(item.multiRate)} double-bubbled
          {item.outOfRangeRate > 0 ? ` · ${pct(item.outOfRangeRate, 1)} out of range` : ''}
          {item.overridden ? ` · ${item.overridden} overridden` : ''}. Choice letters are as authored in the bank; each
          student saw them shuffled.
        </p>
        {item.variations.map((v) => (
          <VariationDetail key={v.variationId} item={item} variation={v} />
        ))}
      </div>
    </details>
  )
}

function GroupTable({ groups, label }: { groups: GroupStats[]; label: string }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500">
        <tr>
          <th className="px-5 py-2 text-left font-medium">{label}</th>
          <th className="px-3 py-2 text-right font-medium">Students</th>
          <th className="px-3 py-2 text-right font-medium">Mean</th>
          <th className="px-3 py-2 text-right font-medium">Median</th>
          <th className="px-3 py-2 text-right font-medium">SD</th>
          <th className="px-3 py-2 text-right font-medium" title="Mean minus the mean of everyone else">
            vs. rest
          </th>
          <th className="px-5 py-2 text-right font-medium" title="Welch's t-test against everyone else">
            p
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {groups.map((g) => {
          const notable = g.n >= 10 && g.pValue !== null && g.pValue < 0.01 && Math.abs(g.diff ?? 0) >= 5
          return (
            <tr key={g.key}>
              <td className="px-5 py-1.5 text-slate-900">
                {g.label}
                {g.kind && g.kind !== 'session' ? <span className="ml-1.5 text-[11px] text-slate-400">{g.kind === 'exception' ? 'exception' : ''}</span> : null}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{g.n}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{g.mean === null ? '—' : `${g.mean.toFixed(1)}%`}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{g.median === null ? '—' : `${g.median.toFixed(1)}%`}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{num(g.sd, 1)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                {g.diff === null ? '—' : `${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)}`}
              </td>
              <td className="px-5 py-1.5 text-right tabular-nums text-slate-700">
                {g.pValue === null ? '—' : formatP(g.pValue)}
                {notable ? <span className="ml-1"><Badge tone="amber">notable</Badge></span> : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default async function RunStatsPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  try {
    await requireRunPermission(runId, 'grade:view')
  } catch (error) {
    if (error instanceof AuthorizationError) notFound()
    throw error
  }

  const { stats, examTitle, runLabel, filename, importedAt } = await loadRunStats(runId)
  const { percent, points } = stats

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link href={`/runs/${runId}`} className="text-xs text-slate-500 hover:underline">
          ← {runLabel}
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Statistics{examTitle ? ` · ${examTitle}` : ''}</h1>
        <p className="mt-0.5 text-xs text-slate-500">
          {filename
            ? `From ${filename}, imported ${importedAt?.toLocaleString()} · reflects manual overrides`
            : 'Not graded yet'}
        </p>
      </div>
      {percent ? (
        <div className="flex gap-2">
          <a
            href={`/api/runs/${runId}/item-analysis.csv`}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Item analysis (CSV)
          </a>
          <a
            href={`/api/runs/${runId}/stats.pdf`}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Report (PDF)
          </a>
        </div>
      ) : null}
    </div>
  )

  if (!percent || !points) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <Empty>No graded students yet. Import the Gradescope export on the run page and statistics appear here.</Empty>
        </Card>
      </div>
    )
  }

  const reviewCount = stats.items.filter((i) => i.quality === 'review').length
  const histogram = scoreHistogramSvg(stats)
  const itemMap = itemMapSvg(stats.items)
  const pe = stats.positionEffect

  return (
    <div className="space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile
          label="Graded"
          value={String(stats.counts.graded)}
          note={stats.counts.notTaken ? `${stats.counts.notTaken} with no sheet` : `of ${stats.counts.roster}`}
        />
        <Tile label="Mean" value={`${percent.mean.toFixed(1)}%`} note={`${points.mean.toFixed(1)} / ${stats.possible} points`} />
        <Tile label="Median" value={`${percent.median.toFixed(1)}%`} note={`middle half ${percent.q1.toFixed(0)}–${percent.q3.toFixed(0)}%`} />
        <Tile label="Standard deviation" value={`${percent.sd.toFixed(1)}`} note={`${points.sd.toFixed(2)} points`} />
        <Tile label="Range" value={`${percent.min.toFixed(0)}–${percent.max.toFixed(0)}%`} note={`${points.min}–${points.max} points`} />
        <Tile
          label="Reliability (α)"
          value={stats.reliability && !stats.smallSample ? stats.reliability.alpha.toFixed(2) : '—'}
          note={
            stats.reliability && !stats.smallSample
              ? `SEM ±${stats.reliability.sem.toFixed(1)} points`
              : `needs ${MIN_STUDENTS_FOR_ITEMS}+ students`
          }
        />
      </div>

      {stats.insights.length ? (
        <Card>
          <CardHeader
            title="Insights"
            subtitle="Generated from the numbers below, most urgent first. Each one is a prompt to look, not a verdict."
          />
          <InsightList insights={stats.insights} questionHref={(order) => `#q-${order}`} />
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <Card>
          <CardHeader
            title="Score distribution"
            subtitle={`Students per score, out of ${stats.possible} points${stats.extraCredit ? ', bonus included' : ''}. Skewness ${percent.skewness.toFixed(2)}.`}
          />
          <Chart svg={histogram} />
        </Card>
        <Card>
          <CardHeader title="Grade bands" subtitle="On the 90/80/70/60 scale, before any curve" />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {stats.bands.map((band) => (
                <tr key={band.grade}>
                  <td className="px-5 py-1.5 font-semibold text-slate-900">{band.grade}</td>
                  <td className="px-2 py-1.5 text-xs text-slate-500">{band.grade === 'F' ? '< 60%' : `≥ ${band.min}%`}</td>
                  <td className="px-2 py-1.5">
                    <Bar value={band.count / stats.counts.graded} className="w-16" />
                  </td>
                  <td className="px-5 py-1.5 text-right tabular-nums text-slate-700">
                    {band.count} <span className="text-slate-400">({pct(band.count / stats.counts.graded)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-slate-200 px-5 py-3">
            <p className="mb-1.5 text-xs font-medium text-slate-600">Percentiles</p>
            <dl className="grid grid-cols-5 gap-1 text-center text-xs">
              {(
                [
                  ['10th', percent.p10],
                  ['25th', percent.q1],
                  ['50th', percent.median],
                  ['75th', percent.q3],
                  ['90th', percent.p90],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="font-medium tabular-nums text-slate-900">{value.toFixed(0)}%</dd>
                </div>
              ))}
            </dl>
          </div>
        </Card>
      </div>

      {stats.smallSample ? (
        <Notice tone="amber" title={`Only ${stats.counts.graded} graded students`}>
          <p className="mt-1 text-xs">
            Discrimination and reliability need at least {MIN_STUDENTS_FOR_ITEMS} students to be meaningful, so they are left
            blank. Difficulty and choice counts are shown but will move a lot with each student.
          </p>
        </Notice>
      ) : null}

      {itemMap ? (
        <Card>
          <CardHeader
            title="Item map"
            subtitle={`Each dot is a question. Higher is better at separating stronger from weaker students; questions flagged for review are labelled. ${reviewCount ? `${reviewCount} flagged.` : 'None flagged.'}`}
          />
          <Chart svg={itemMap} />
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Item analysis"
          subtitle="Click a question for its variations and how often each choice was picked."
        />
        <div className="overflow-x-auto">
          <div className="min-w-[56rem]">
            <div className={`${ITEM_GRID} border-b border-slate-200 bg-slate-50 px-5 py-2 text-xs font-medium text-slate-500`}>
              <span>#</span>
              <span>Question</span>
              <span title="Share of the points earned: the difficulty index">Correct</span>
              <span className="text-right" title="Corrected point-biserial correlation with the rest of the exam">
                Discrim.
              </span>
              <span className="text-right" title="Top 27% correct minus bottom 27% correct">
                Upper−lower
              </span>
              <span className="text-right">Blank</span>
              <span>By variation</span>
              <span className="text-right">Quality</span>
            </div>
            {stats.items.map((item) => (
              <ItemRow key={item.questionId} item={item} />
            ))}
          </div>
        </div>
      </Card>

      {stats.positions.length > 1 ? (
        <Card>
          <CardHeader
            title="Position on the paper"
            subtitle="Every student's question order is shuffled, so each position holds a mix of every question: any trend here is about where a question sat — fatigue or time — not which question it was."
          />
          <div className="grid gap-x-6 lg:grid-cols-2">
            <div>
              <p className="px-5 pt-4 text-xs font-medium text-slate-600">Answered correctly</p>
              <Chart svg={positionLineSvg(stats.positions, 'p')} />
            </div>
            <div>
              <p className="px-5 pt-4 text-xs font-medium text-slate-600">Left blank</p>
              <Chart svg={positionLineSvg(stats.positions, 'blankRate')} />
            </div>
          </div>
          {pe ? (
            <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
              Positions {pe.early.from}–{pe.early.to}: {pct(pe.early.p, 1)} correct, {pct(pe.early.blankRate, 1)} blank.
              Positions {pe.late.from}–{pe.late.to}: {pct(pe.late.p, 1)} correct, {pct(pe.late.blankRate, 1)} blank
              (p = {formatP(pe.pValueCorrect)} for correct, {formatP(pe.pValueBlank)} for blanks).
            </p>
          ) : null}
        </Card>
      ) : null}

      {stats.variationLuck ? (
        <Card>
          <CardHeader
            title="Variation fairness"
            subtitle="How much the random draw of variations moved each student's expected score, given how hard each variation turned out to be."
          />
          <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-4">
            <Tile label="Spread (SD)" value={`${stats.variationLuck.sd.toFixed(2)} pts`} />
            <Tile label="Unluckiest draw" value={`${stats.variationLuck.min.toFixed(2)} pts`} />
            <Tile label="Luckiest draw" value={`+${stats.variationLuck.max.toFixed(2)} pts`} />
            <Tile label="Moved ≥ 1 point" value={pct(stats.variationLuck.overOnePoint)} />
          </div>
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
            {stats.items.filter((i) => i.variationTest?.significant).length
              ? `Questions whose variations differ beyond chance: ${stats.items
                  .filter((i) => i.variationTest?.significant)
                  .map((i) => `Q${i.order}`)
                  .join(', ')}.`
              : 'No question’s variations differ in difficulty beyond what chance would produce.'}
          </p>
        </Card>
      ) : null}

      {stats.sections.length ? (
        <Card>
          <CardHeader
            title="By section"
            subtitle="A student in two sections (a lecture and its recitation) counts in both."
          />
          <GroupTable groups={stats.sections} label="Section" />
        </Card>
      ) : null}

      {stats.sessions.length ? (
        <Card>
          <CardHeader
            title="By session"
            subtitle={
              stats.sessionTrend
                ? `In chronological order. Score against session order: r = ${stats.sessionTrend.r.toFixed(2)}, p = ${formatP(stats.sessionTrend.pValue)}.`
                : 'From the sign-up sheet.'
            }
          />
          <GroupTable groups={stats.sessions} label="Session" />
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Responses" subtitle={`${stats.responses.total.toLocaleString()} bubbled answers across graded students`} />
        <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-5">
          <Tile label="Left blank" value={pct(stats.responses.blank / Math.max(1, stats.responses.total), 1)} note={`${stats.responses.blank}`} />
          <Tile label="Double-bubbled" value={pct(stats.responses.multi / Math.max(1, stats.responses.total), 1)} note={`${stats.responses.multi}`} />
          <Tile label="Out of range" value={String(stats.responses.outOfRange)} />
          <Tile label="Overridden" value={String(stats.responses.overridden)} />
          <Tile
            label="Unresolved flags"
            value={String(stats.responses.unresolvedFlags)}
            note={stats.responses.unresolvedFlags ? 'resolve on the run page' : 'all reviewed'}
          />
        </div>
        {stats.extraCredit ? (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
            Extra credit (row {stats.extraCredit.position}): {stats.extraCredit.attempted} bubbled it, {stats.extraCredit.earned}{' '}
            earned it. Without the bonus the mean would be {stats.extraCredit.meanWithout?.toFixed(1)}%. Item analysis and
            reliability leave the bonus out.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="How to read this" />
        <dl className="grid gap-x-8 gap-y-3 px-5 py-4 text-xs text-slate-600 md:grid-cols-2">
          <div>
            <dt className="font-semibold text-slate-900">Correct (difficulty)</dt>
            <dd>
              Share of the question&apos;s points the class earned. Below {pct(HARD_P)} is very hard; {pct(EASY_P)} or more tells
              students apart very little.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Discrimination</dt>
            <dd>
              Correlation between getting this question right and the score on the rest of the exam. {DISCRIMINATION_GOOD}+ is
              good, {DISCRIMINATION_FAIR}–{DISCRIMINATION_GOOD} fair, below {DISCRIMINATION_FAIR} weak, and below zero means
              stronger students did worse.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Upper−lower</dt>
            <dd>
              Share correct among the top 27% of the class (by the rest of the exam) minus the share among the bottom 27%. The
              same idea as discrimination, in plainer units.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Choices</dt>
            <dd>
              Choices are tallied by what they say, not by letter: every paper shuffles them. A wrong choice that the top 27% pick
              more often than the key, while the key itself fails to attract them, is flagged as a possible key.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Reliability (α)</dt>
            <dd>
              Cronbach&apos;s alpha (KR-20 for right/wrong questions): how consistently the exam ranks students. 0.8+ is good for a
              classroom exam; 0.7 is acceptable. SEM is how far an observed score typically sits from a student&apos;s
              &quot;true&quot; score.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Variation fairness</dt>
            <dd>
              Variations are drawn at random, so a difference in how often each was answered correctly belongs to the variation.
              A χ² test asks whether the difference is more than chance.
            </dd>
          </div>
        </dl>
      </Card>
    </div>
  )
}
