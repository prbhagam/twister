import type { ExamStats, ItemStats, PositionStats } from './stats'
import { DISCRIMINATION_FAIR, DISCRIMINATION_GOOD } from './stats'

/**
 * The statistics charts, as SVG strings so the page and the PDF report draw from
 * one source. Each mark carries a <title>, which is the hover tooltip on screen
 * and harmless on paper.
 *
 * Every chart here is a single series, so none needs a legend: the card's title
 * says what is plotted. The one accent color is reserved for questions flagged
 * for review, and those are always labelled with their number too, so color is
 * never the only thing marking them.
 */

const C = {
  series: '#2a78d6',
  wash: 'rgba(42, 120, 214, 0.10)',
  critical: '#d03b3b',
  grid: '#e2e8f0',
  axis: '#cbd5e1',
  text: '#64748b',
  ink: '#0f172a',
  surface: '#ffffff',
}

const FONT = `font-family="ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif"`

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function svg(width: number, height: number, label: string, body: string): string {
  return (
    `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="${esc(label)}" ${FONT} ` +
    `style="display:block;max-width:${width}px;height:auto">` +
    `<style>.m{transition:opacity .1s}.m:hover{opacity:.7}</style>${body}</svg>`
  )
}

/** A column with a 4px rounded data end and a square foot on the baseline. */
function column(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return (
    `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
  )
}

/** A round axis maximum whose half is a whole number, so the midline label is exact. */
function niceMax(value: number): number {
  if (value <= 4) return 4
  const step = 10 ** Math.floor(Math.log10(value))
  for (const m of [1, 2, 4, 5, 10]) {
    const max = m * step
    if (value <= max) return max % 2 === 0 ? max : max + 1
  }
  return 10 * step
}

/** Score distribution: one column per bin of raw points, with the mean marked. */
export function scoreHistogramSvg(stats: ExamStats, options: { compact?: boolean } = {}): string {
  const bins = stats.histogram
  if (!bins.length || !stats.points) return ''
  const W = 640
  const H = options.compact ? 150 : 220
  const m = { top: 22, right: 12, bottom: 30, left: 34 }
  const plotW = W - m.left - m.right
  const plotH = H - m.top - m.bottom
  const maxCount = niceMax(Math.max(...bins.map((b) => b.count)))
  const slot = plotW / bins.length
  const barW = Math.min(24, Math.max(1, slot - 2))
  const top = bins.at(-1)!.to
  const xOf = (points: number) => m.left + (points / top) * plotW
  const yOf = (count: number) => m.top + plotH - (count / maxCount) * plotH

  const parts: string[] = []
  // Recessive grid: three hairlines and their counts.
  for (const t of [0, 0.5, 1]) {
    const y = yOf(maxCount * t)
    parts.push(`<line x1="${m.left}" x2="${W - m.right}" y1="${y}" y2="${y}" stroke="${t === 0 ? C.axis : C.grid}" stroke-width="1"/>`)
    parts.push(`<text x="${m.left - 6}" y="${y + 3.5}" font-size="10" fill="${C.text}" text-anchor="end">${Math.round(maxCount * t)}</text>`)
  }

  bins.forEach((bin, i) => {
    const x = m.left + i * slot + (slot - barW) / 2
    const y = yOf(bin.count)
    const range = bin.to - bin.from === 1 ? `${bin.from}` : `${bin.from}–${bin.to - 1}`
    const percent = stats.possible ? ` (${Math.round((bin.from / stats.possible) * 100)}%)` : ''
    const tip = `${range} point${range === '1' ? '' : 's'}${percent}: ${bin.count} student${bin.count === 1 ? '' : 's'}`
    // The hit target is the whole slot, taller than the mark, so short bars hover.
    parts.push(
      `<g class="m"><title>${esc(tip)}</title>` +
        `<rect x="${m.left + i * slot}" y="${m.top}" width="${slot}" height="${plotH}" fill="transparent"/>` +
        `<path d="${column(x, y, barW, m.top + plotH - y)}" fill="${C.series}"/></g>`,
    )
  })

  // X axis in percent of the exam, which is how people talk about scores.
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const points = stats.possible * t
    const x = xOf(points + (top / bins.length) / 2)
    parts.push(`<text x="${x}" y="${H - 10}" font-size="10" fill="${C.text}" text-anchor="middle">${Math.round(t * 100)}%</text>`)
  }

  const mean = stats.points.mean
  const mx = xOf(mean + (top / bins.length) / 2)
  parts.push(`<line x1="${mx}" x2="${mx}" y1="${m.top - 4}" y2="${m.top + plotH}" stroke="${C.ink}" stroke-width="1.5"/>`)
  parts.push(
    `<text x="${mx}" y="${m.top - 8}" font-size="10.5" font-weight="600" fill="${C.ink}" text-anchor="${mx > W - 90 ? 'end' : 'middle'}">mean ${(stats.percent!.mean).toFixed(1)}%</text>`,
  )

  return svg(W, H, `Histogram of ${stats.counts.graded} scores`, parts.join(''))
}

/**
 * Item map: difficulty against discrimination, one dot per question. The good
 * region is the upper middle; the reference lines are the thresholds the item
 * table grades against.
 */
export function itemMapSvg(items: ItemStats[], options: { linkPrefix?: string } = {}): string {
  const plotted = items.filter((i) => i.p !== null && i.discrimination !== null)
  if (!plotted.length) return ''
  const W = 640
  const H = 300
  const m = { top: 14, right: 16, bottom: 40, left: 46 }
  const plotW = W - m.left - m.right
  const plotH = H - m.top - m.bottom
  const lowest = Math.min(-0.2, ...plotted.map((i) => i.discrimination!))
  const highest = Math.max(0.8, ...plotted.map((i) => i.discrimination!))
  const yMin = Math.floor(lowest * 10) / 10
  const yMax = Math.ceil(highest * 10) / 10
  const xOf = (p: number) => m.left + p * plotW
  const yOf = (d: number) => m.top + ((yMax - d) / (yMax - yMin)) * plotH

  const parts: string[] = []
  for (let t = 0; t <= 1.0001; t += 0.25) {
    const x = xOf(t)
    parts.push(`<line x1="${x}" x2="${x}" y1="${m.top}" y2="${m.top + plotH}" stroke="${C.grid}" stroke-width="1"/>`)
    parts.push(`<text x="${x}" y="${m.top + plotH + 14}" font-size="10" fill="${C.text}" text-anchor="middle">${Math.round(t * 100)}%</text>`)
  }
  parts.push(`<text x="${m.left + plotW / 2}" y="${H - 6}" font-size="10.5" fill="${C.text}" text-anchor="middle">Answered correctly (difficulty)</text>`)

  const refs: [number, string][] = [
    [0, '0'],
    [DISCRIMINATION_FAIR, `${DISCRIMINATION_FAIR} fair`],
    [DISCRIMINATION_GOOD, `${DISCRIMINATION_GOOD} good`],
  ]
  for (const [d, label] of refs) {
    const y = yOf(d)
    parts.push(`<line x1="${m.left}" x2="${W - m.right}" y1="${y}" y2="${y}" stroke="${d === 0 ? C.axis : C.grid}" stroke-width="1"/>`)
    parts.push(`<text x="${m.left - 6}" y="${y + 3.5}" font-size="10" fill="${C.text}" text-anchor="end">${esc(label.split(' ')[0])}</text>`)
    if (d > 0) parts.push(`<text x="${W - m.right - 2}" y="${y - 4}" font-size="10" fill="${C.text}" text-anchor="end">${esc(label.split(' ')[1])}</text>`)
  }
  parts.push(
    `<text transform="translate(12 ${m.top + plotH / 2}) rotate(-90)" font-size="10.5" fill="${C.text}" text-anchor="middle">Discrimination</text>`,
  )

  // Flagged questions draw last so they sit on top of the cloud. Their labels are
  // placed greedily: right of the dot, then left, above, below. A label with no
  // free spot is dropped rather than stacked — the dot stays red and its tooltip
  // and the item table still name it.
  const ordered = plotted.slice().sort((a, b) => Number(a.quality === 'review') - Number(b.quality === 'review'))
  const placed: { x: number; y: number; w: number; h: number }[] = []
  const overlaps = (r: { x: number; y: number; w: number; h: number }) =>
    placed.some((o) => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h)
  const labelAt = (x: number, y: number, text: string) => {
    const w = text.length * 6.2
    const h = 11
    const candidates = [
      { x: x + 8, y: y - h / 2, anchor: 'start' },
      { x: x - 8 - w, y: y - h / 2, anchor: 'start' },
      { x: x - w / 2, y: y - 8 - h, anchor: 'start' },
      { x: x - w / 2, y: y + 8, anchor: 'start' },
    ]
    const spot = candidates.find(
      (c) => c.x >= m.left && c.x + w <= W - m.right && c.y >= 0 && c.y + h <= m.top + plotH && !overlaps({ ...c, w, h }),
    )
    if (!spot) return ''
    placed.push({ x: spot.x, y: spot.y, w, h })
    return `<text x="${spot.x}" y="${spot.y + h - 2}" font-size="10.5" font-weight="600" fill="${C.ink}">${esc(text)}</text>`
  }
  for (const item of ordered) {
    const flagged = item.quality === 'review'
    const x = xOf(item.p!)
    const y = yOf(item.discrimination!)
    const tip =
      `Q${item.order}${item.title ? ` · ${item.title}` : ''}\n` +
      `${Math.round(item.p! * 100)}% correct · discrimination ${item.discrimination!.toFixed(2)}` +
      (item.reasons.length ? `\n${item.reasons.join('; ')}` : '')
    const dot =
      `<circle cx="${x}" cy="${y}" r="10" fill="transparent"/>` +
      `<circle cx="${x}" cy="${y}" r="4.5" fill="${flagged ? C.critical : C.series}" stroke="${C.surface}" stroke-width="2"/>` +
      (flagged ? labelAt(x, y, `Q${item.order}`) : '')
    const mark = `<g class="m"><title>${esc(tip)}</title>${dot}</g>`
    parts.push(options.linkPrefix !== undefined ? `<a href="${options.linkPrefix}#q-${item.order}">${mark}</a>` : mark)
  }

  return svg(W, H, 'Each question’s difficulty against its discrimination', parts.join(''))
}

/**
 * A per-position line, 0–100%. Used twice — share correct and share left blank —
 * as two charts rather than one with two scales.
 */
export function positionLineSvg(
  positions: PositionStats[],
  metric: 'p' | 'blankRate',
  options: { height?: number } = {},
): string {
  const points = positions.filter((p) => (metric === 'p' ? p.p !== null : true))
  if (points.length < 2) return ''
  const W = 640
  const H = options.height ?? 170
  const m = { top: 14, right: 14, bottom: 30, left: 40 }
  const plotW = W - m.left - m.right
  const plotH = H - m.top - m.bottom
  const values = points.map((p) => (metric === 'p' ? p.p! : p.blankRate))
  const yMax = metric === 'p' ? 1 : Math.max(0.05, Math.ceil(Math.max(...values) * 20) / 20)
  const last = points.at(-1)!.position
  const xOf = (position: number) => m.left + ((position - 1) / Math.max(1, last - 1)) * plotW
  const yOf = (v: number) => m.top + plotH - (v / yMax) * plotH

  const parts: string[] = []
  for (const t of [0, 0.5, 1]) {
    const y = yOf(yMax * t)
    parts.push(`<line x1="${m.left}" x2="${W - m.right}" y1="${y}" y2="${y}" stroke="${t === 0 ? C.axis : C.grid}" stroke-width="1"/>`)
    parts.push(`<text x="${m.left - 6}" y="${y + 3.5}" font-size="10" fill="${C.text}" text-anchor="end">${Math.round(yMax * t * 100)}%</text>`)
  }
  const ticks = [1, ...[0.25, 0.5, 0.75].map((f) => Math.round(1 + f * (last - 1))), last]
  for (const t of [...new Set(ticks)]) {
    parts.push(`<text x="${xOf(t)}" y="${H - 10}" font-size="10" fill="${C.text}" text-anchor="middle">${t}</text>`)
  }

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.position).toFixed(1)},${yOf(values[i]).toFixed(1)}`).join('')
  const area = `${line}L${xOf(last)},${yOf(0)}L${xOf(points[0].position)},${yOf(0)}Z`
  parts.push(`<path d="${area}" fill="${C.wash}"/>`)
  parts.push(`<path d="${line}" fill="none" stroke="${C.series}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)

  // Invisible full-height columns carry each position's tooltip.
  const slot = plotW / Math.max(1, last - 1)
  points.forEach((p, i) => {
    const label = metric === 'p' ? 'correct' : 'left blank'
    parts.push(
      `<g class="m"><title>Position ${p.position}: ${(values[i] * 100).toFixed(1)}% ${label} (n=${p.n})</title>` +
        `<rect x="${xOf(p.position) - slot / 2}" y="${m.top}" width="${slot}" height="${plotH}" fill="transparent"/></g>`,
    )
  })

  const label = metric === 'p' ? 'Share correct by position on the paper' : 'Share left blank by position on the paper'
  return svg(W, H, label, parts.join(''))
}
