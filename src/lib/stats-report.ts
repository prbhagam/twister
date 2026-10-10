import Papa from 'papaparse'
import { LETTERS } from './seed'
import {
  DISCRIMINATION_FAIR,
  DISCRIMINATION_GOOD,
  formatP,
  type ExamStats,
  type GroupStats,
  type InsightSeverity,
  type ItemStats,
  type VariationStats,
} from './stats'
import { itemMapSvg, positionLineSvg, scoreHistogramSvg } from './stats-charts'

const share = (x: number | null | undefined, digits = 1) => (x === null || x === undefined ? '' : (x * 100).toFixed(digits))
const fixed = (x: number | null | undefined, digits = 3) => (x === null || x === undefined ? '' : x.toFixed(digits))

/**
 * Item analysis as a spreadsheet: one row per question across all its
 * variations, then one row per variation with how often each authored choice was
 * picked. Choice columns are blank on the question row, since choices differ
 * between variations. Contains no student-identifying data.
 */
export function itemAnalysisCsv(stats: ExamStats): string {
  const fields = [
    'Question',
    'Title',
    'Variation',
    'Prompt',
    'Points',
    'N',
    'Correct %',
    'Discrimination',
    'Upper-lower',
    'Blank %',
    'Double-bubbled %',
    'Out of range %',
    'Variation difference p',
    'Quality',
    'Flags',
    'Key',
    ...LETTERS.map((l) => `${l} %`),
    'Key: top 27% %',
    'Key: bottom 27% %',
    'Most chosen wrong answer',
    'Rarely chosen',
  ]

  const variationRow = (item: ItemStats, v: VariationStats) => {
    const key = v.choices.filter((c) => c.isCorrect)
    const byLabel = new Map(v.choices.map((c) => [c.label, c]))
    const wrong = v.choices.filter((c) => !c.isCorrect).sort((a, b) => b.rate - a.rate)[0]
    const keyUpper = key.length === 1 ? key[0].upperRate : null
    const keyLower = key.length === 1 ? key[0].lowerRate : null
    return [
      item.order,
      item.title ?? '',
      v.label,
      v.summary,
      item.points,
      v.n,
      share(v.p),
      fixed(v.discrimination),
      '',
      share(v.n ? v.blank / v.n : null),
      share(v.n ? v.multi / v.n : null),
      share(v.n ? v.invalid / v.n : null),
      '',
      '',
      v.suspectedMiskey ? `possible key: ${v.suspectedMiskey.label}` : '',
      key.map((c) => c.label).join(''),
      ...LETTERS.map((l) => share(byLabel.get(l)?.rate)),
      share(keyUpper),
      share(keyLower),
      wrong ? `${wrong.label} (${share(wrong.rate, 0)}%)` : '',
      v.choices.filter((c) => c.nonFunctional).map((c) => c.label).join(' '),
    ]
  }

  const data = stats.items.flatMap((item) => {
    const questionRow = [
      item.order,
      item.title ?? '',
      item.variations.length > 1 ? 'All' : item.variations[0]?.label ?? '',
      item.summary,
      item.points,
      item.n,
      share(item.p),
      fixed(item.discrimination),
      fixed(item.upperLower),
      share(item.blankRate),
      share(item.multiRate),
      share(item.outOfRangeRate),
      item.variationTest ? formatP(item.variationTest.pValue) : '',
      item.quality,
      item.reasons.join('; '),
      ...Array(LETTERS.length + 5).fill(''),
    ]
    if (item.variations.length === 1) {
      // One variation: fold its choice breakdown into the question's own row.
      const v = variationRow(item, item.variations[0])
      return [[...questionRow.slice(0, 15), ...v.slice(15)]]
    }
    return [questionRow, ...item.variations.map((v) => variationRow(item, v))]
  })

  return Papa.unparse({ fields, data })
}

// ---------------------------------------------------------------- PDF report

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const pc = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`)
const n2 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(2))

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  critical: '! Check now',
  warning: '▲ Worth a look',
  info: 'i Note',
  good: '✓ Good',
}

const QUALITY_LABEL = { good: 'Good', fair: 'Fair', weak: 'Weak', review: 'Review' } as const

const STYLES = String.raw`
  @page { size: Letter; margin: 0.6in 0.6in 0.7in 0.6in; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #0f172a; font: 10pt/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 17pt; margin: 0 0 2pt; }
  h2 { font-size: 11.5pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #e2e8f0; break-after: avoid; }
  .meta { color: #64748b; font-size: 9pt; margin: 0; }
  .muted { color: #64748b; }
  .tiles { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6pt; margin-top: 12pt; }
  .tile { border: 1px solid #e2e8f0; border-radius: 4pt; padding: 5pt 7pt; }
  .tile b { display: block; font-size: 13pt; }
  .tile span { color: #64748b; font-size: 8pt; }
  .insight { display: grid; grid-template-columns: 78pt 1fr; gap: 8pt; padding: 5pt 0; border-bottom: 1px solid #f1f5f9; break-inside: avoid; }
  .sev { font-size: 8pt; font-weight: 600; border-radius: 3pt; padding: 1pt 4pt; align-self: start; text-align: center; }
  .sev.critical { background: #fee2e2; color: #991b1b; } .sev.warning { background: #fef3c7; color: #78350f; }
  .sev.info { background: #f1f5f9; color: #334155; } .sev.good { background: #d1fae5; color: #065f46; }
  .insight p { margin: 0; } .insight p + p { color: #475569; font-size: 9pt; }
  table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  th { text-align: left; font-weight: 600; color: #64748b; border-bottom: 1px solid #cbd5e1; padding: 3pt 4pt; }
  td { border-bottom: 1px solid #f1f5f9; padding: 3pt 4pt; vertical-align: top; }
  td.r, th.r { text-align: right; font-variant-numeric: tabular-nums; }
  tr { break-inside: avoid; }
  .q { font-weight: 600; white-space: nowrap; }
  .flag { color: #991b1b; font-weight: 600; }
  .choices { color: #475569; font-size: 8pt; }
  .choices .key { color: #065f46; font-weight: 600; }
  .choices .rival { color: #991b1b; font-weight: 600; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14pt; }
  .chart { break-inside: avoid; margin: 4pt 0; }
  .note { font-size: 8.5pt; color: #475569; margin: 4pt 0 0; }
  dl.glossary { font-size: 8.5pt; color: #475569; columns: 2; column-gap: 16pt; }
  dl.glossary dt { font-weight: 600; color: #0f172a; } dl.glossary dd { margin: 0 0 6pt; break-inside: avoid; }
`

function choiceLine(v: VariationStats): string {
  return v.choices
    .map((c) => {
      const cls = c.isCorrect ? 'key' : v.suspectedMiskey?.choiceId === c.choiceId ? 'rival' : ''
      return `<span class="${cls}">${esc(c.label)}${c.isCorrect ? '✓' : ''} ${pc(c.rate)}</span>`
    })
    .join(' · ')
}

function itemRows(item: ItemStats): string {
  const multi = item.variations.length > 1
  const head =
    `<tr><td class="q">Q${item.order}</td>` +
    `<td>${item.title ? `<b>${esc(item.title)}</b> ` : ''}${esc(item.summary)}` +
    (item.reasons.length ? `<div class="flag">${esc(item.reasons.join('; '))}</div>` : '') +
    (!multi ? `<div class="choices">${choiceLine(item.variations[0])}</div>` : '') +
    `</td><td class="r">${pc(item.p)}</td><td class="r">${n2(item.discrimination)}</td><td class="r">${n2(item.upperLower)}</td>` +
    `<td class="r">${pc(item.blankRate)}</td><td>${QUALITY_LABEL[item.quality]}</td></tr>`
  if (!multi) return head
  const variations = item.variations
    .map(
      (v) =>
        `<tr><td></td><td class="choices">Variation ${esc(v.label)} (n=${v.n}): ${choiceLine(v)}</td>` +
        `<td class="r">${pc(v.p)}</td><td class="r">${n2(v.discrimination)}</td><td></td><td class="r">${pc(v.n ? v.blank / v.n : null)}</td>` +
        `<td>${v.suspectedMiskey ? '<span class="flag">key?</span>' : ''}</td></tr>`,
    )
    .join('')
  return head + variations
}

function groupTable(groups: GroupStats[], label: string): string {
  return (
    `<table><thead><tr><th>${label}</th><th class="r">Students</th><th class="r">Mean</th><th class="r">Median</th><th class="r">SD</th><th class="r">vs. rest</th><th class="r">p</th></tr></thead><tbody>` +
    groups
      .map(
        (g) =>
          `<tr><td>${esc(g.label)}</td><td class="r">${g.n}</td><td class="r">${g.mean?.toFixed(1) ?? '—'}%</td>` +
          `<td class="r">${g.median?.toFixed(1) ?? '—'}%</td><td class="r">${g.sd?.toFixed(1) ?? '—'}</td>` +
          `<td class="r">${g.diff === null ? '—' : `${g.diff > 0 ? '+' : ''}${g.diff.toFixed(1)}`}</td>` +
          `<td class="r">${g.pValue === null ? '—' : formatP(g.pValue)}</td></tr>`,
      )
      .join('') +
    '</tbody></table>'
  )
}

/**
 * The statistics page as a standalone, printable document. Aggregate only: no
 * student names or identifiers appear anywhere in it, so it can go to TAs or a
 * course coordinator.
 */
export function statsReportHtml(params: {
  stats: ExamStats
  courseName: string
  examTitle: string
  runLabel: string
  filename: string | null
  generatedAt: Date
}): string {
  const { stats, courseName, examTitle, runLabel, filename, generatedAt } = params
  const { percent, points } = stats
  if (!percent || !points) throw new Error('This run has no graded students.')

  const tile = (label: string, value: string, note = '') => `<div class="tile"><span>${label}</span><b>${value}</b><span>${note}</span></div>`
  const alpha = stats.reliability && !stats.smallSample ? stats.reliability : null
  const pe = stats.positionEffect

  const sections: string[] = []
  sections.push(
    `<h1>${esc(examTitle || 'Exam')} — statistics</h1>` +
      `<p class="meta">${esc([courseName, runLabel, filename ? `graded from ${filename}` : ''].filter(Boolean).join(' · '))}</p>` +
      `<p class="meta">Generated ${esc(generatedAt.toLocaleString())}. Aggregate figures only; reflects manual overrides.</p>` +
      `<div class="tiles">` +
      tile('Graded', String(stats.counts.graded), stats.counts.notTaken ? `${stats.counts.notTaken} no sheet` : `of ${stats.counts.roster}`) +
      tile('Mean', `${percent.mean.toFixed(1)}%`, `${points.mean.toFixed(1)} / ${stats.possible}`) +
      tile('Median', `${percent.median.toFixed(1)}%`, `IQR ${percent.q1.toFixed(0)}–${percent.q3.toFixed(0)}%`) +
      tile('Std. dev.', percent.sd.toFixed(1), `${points.sd.toFixed(2)} pts`) +
      tile('Range', `${percent.min.toFixed(0)}–${percent.max.toFixed(0)}%`, `${points.min}–${points.max} pts`) +
      tile('Reliability α', alpha ? alpha.alpha.toFixed(2) : '—', alpha ? `SEM ±${alpha.sem.toFixed(1)} pts` : 'too few students') +
      `</div>`,
  )

  if (stats.insights.length) {
    sections.push(
      `<h2>Insights</h2>` +
        stats.insights
          .map(
            (i) =>
              `<div class="insight"><span class="sev ${i.severity}">${SEVERITY_LABEL[i.severity]}</span>` +
              `<div><p><b>${esc(i.title)}</b></p><p>${esc(i.detail)}</p></div></div>`,
          )
          .join(''),
    )
  }

  sections.push(
    `<h2>Score distribution</h2><div class="chart">${scoreHistogramSvg(stats)}</div>` +
      `<div class="two"><table><thead><tr><th>Grade</th><th class="r">Students</th><th class="r">Share</th></tr></thead><tbody>` +
      stats.bands
        .map(
          (b) =>
            `<tr><td>${b.grade} (${b.grade === 'F' ? '&lt; 60' : `≥ ${b.min}`}%)</td><td class="r">${b.count}</td><td class="r">${pc(b.count / stats.counts.graded)}</td></tr>`,
        )
        .join('') +
      `</tbody></table><table><thead><tr><th>Percentile</th><th class="r">Score</th></tr></thead><tbody>` +
      (
        [
          ['10th', percent.p10],
          ['25th', percent.q1],
          ['50th', percent.median],
          ['75th', percent.q3],
          ['90th', percent.p90],
        ] as const
      )
        .map(([l, v]) => `<tr><td>${l}</td><td class="r">${v.toFixed(1)}%</td></tr>`)
        .join('') +
      `</tbody></table></div>` +
      `<p class="note">Skewness ${percent.skewness.toFixed(2)}.${stats.extraCredit ? ` Scores include the extra-credit point; without it the mean would be ${stats.extraCredit.meanWithout?.toFixed(1)}%. ${stats.extraCredit.earned} of ${stats.counts.graded} earned it.` : ''}</p>`,
  )

  const map = itemMapSvg(stats.items)
  if (map) {
    sections.push(
      `<h2>Item map</h2><div class="chart">${map}</div>` +
        `<p class="note">Each dot is a question: how often it was answered correctly against how well it separates stronger from weaker students. Questions flagged for review are labelled.</p>`,
    )
  }

  sections.push(
    `<h2>Item analysis</h2>` +
      `<table><thead><tr><th>#</th><th>Question · choices as authored, ✓ the key, % who chose each</th><th class="r">Correct</th><th class="r">Discrim.</th><th class="r">Upper−lower</th><th class="r">Blank</th><th>Quality</th></tr></thead><tbody>` +
      stats.items.map(itemRows).join('') +
      `</tbody></table>`,
  )

  if (stats.positions.length > 1) {
    sections.push(
      `<h2>Position on the paper</h2>` +
        `<div class="two"><div class="chart"><p class="note">Answered correctly</p>${positionLineSvg(stats.positions, 'p', { height: 190 })}</div>` +
        `<div class="chart"><p class="note">Left blank</p>${positionLineSvg(stats.positions, 'blankRate', { height: 190 })}</div></div>` +
        (pe
          ? `<p class="note">Question order is shuffled per student, so a trend here is about position, not content. Positions ${pe.early.from}–${pe.early.to}: ${pc(pe.early.p, 1)} correct, ${pc(pe.early.blankRate, 1)} blank. Positions ${pe.late.from}–${pe.late.to}: ${pc(pe.late.p, 1)} correct, ${pc(pe.late.blankRate, 1)} blank.</p>`
          : ''),
    )
  }

  if (stats.variationLuck) {
    const luck = stats.variationLuck
    const uneven = stats.items.filter((i) => i.variationTest?.significant).map((i) => `Q${i.order}`)
    sections.push(
      `<h2>Variation fairness</h2><p class="note">Given how hard each variation turned out to be, the random draw moved students' expected scores by ` +
        `${luck.min.toFixed(2)} to +${luck.max.toFixed(2)} points (SD ${luck.sd.toFixed(2)}); ${pc(luck.overOnePoint)} were moved a point or more. ` +
        (uneven.length ? `Variations differ beyond chance on ${uneven.join(', ')}.` : 'No question’s variations differ beyond chance.') +
        `</p>`,
    )
  }

  if (stats.sections.length) sections.push(`<h2>By section</h2>${groupTable(stats.sections, 'Section')}`)
  if (stats.sessions.length) {
    sections.push(
      `<h2>By session</h2>${groupTable(stats.sessions, 'Session')}` +
        (stats.sessionTrend
          ? `<p class="note">Score against session order: r = ${stats.sessionTrend.r.toFixed(2)}, p = ${formatP(stats.sessionTrend.pValue)}.</p>`
          : ''),
    )
  }

  sections.push(
    `<h2>How to read this</h2><dl class="glossary">` +
      `<dt>Correct (difficulty)</dt><dd>Share of the question's points the class earned.</dd>` +
      `<dt>Discrimination</dt><dd>Correlation between this question and the score on the rest of the exam. ${DISCRIMINATION_GOOD}+ good, ${DISCRIMINATION_FAIR}–${DISCRIMINATION_GOOD} fair, below ${DISCRIMINATION_FAIR} weak, negative means stronger students did worse.</dd>` +
      `<dt>Upper−lower</dt><dd>Share correct in the top 27% of the class minus the bottom 27%, ranked on the rest of the exam.</dd>` +
      `<dt>Choices</dt><dd>Tallied by what each choice says rather than by letter, since every paper shuffles them. Letters are as authored in the question bank.</dd>` +
      `<dt>Reliability (α)</dt><dd>Cronbach's alpha (KR-20): how consistently the exam ranks students. 0.8+ good, 0.7 acceptable. SEM is the typical distance between an observed and a "true" score.</dd>` +
      `<dt>Variation fairness</dt><dd>Variations are drawn at random, so a difference in how often each was answered correctly belongs to the variation; a χ² test separates that from chance.</dd>` +
      `</dl>`,
  )

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(examTitle)} statistics</title><style>${STYLES}</style></head><body>${sections.join('')}</body></html>`
}
