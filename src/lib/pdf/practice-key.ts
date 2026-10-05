import { codeThemeCss } from '../print-theme'

export interface KeyChoice {
  /** The letter as printed on that variant's paper, A-E. */
  letter: string
  html: string
  correct: boolean
}

export interface KeyEntry {
  /** 1-based position on the paper, which is also the bubble-sheet row. */
  position: number
  points: number
  /** More than one only for a select-all-that-apply question. */
  correctLetters: string[]
  promptHtml: string
  choices: KeyChoice[]
}

export interface KeyVariant {
  label: string
  traceCode: string
  entries: KeyEntry[]
}

export interface PracticeKey {
  courseName: string
  examTitle: string
  generatedOn: string
  variants: KeyVariant[]
  /**
   * Reported whether or not it is printed on the paper: the bonus row is graded
   * either way, so a key that omitted it would be an incomplete key.
   */
  extraCredit?: { position: number; letters: string[]; onPaper: boolean }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

export function keyTotals(variant: KeyVariant): { questions: number; points: number } {
  return {
    questions: variant.entries.length,
    points: variant.entries.reduce((n, e) => n + e.points, 0),
  }
}

/**
 * Print styles for the key.
 *
 * This is a student handout, posted alongside the practice paper so people can
 * score themselves — not an instructor document. It shares the question bank's
 * palette for familiarity, but it deliberately carries nothing about how the bank
 * is authored: no question numbers from the bank, no variation labels, no
 * workflow status.
 *
 * The grid is CSS columns rather than a table so a short exam fills one tight block
 * instead of four sparse ones, and `break-inside: avoid` on each row keeps a
 * position from splitting across the column boundary.
 */
export const KEY_STYLES = String.raw`
  @page { size: Letter; margin: 0.6in 0.7in 0.75in 0.7in; }

  :root {
    --ink: #16191d;
    --muted: #5c6470;
    --rule: #dfe3e8;
    --accent: #1c3f94;
    --ok: #17703f;
    --ok-bg: #e8f5ee;
    --surface: #f6f8fa;
    --sans: "Helvetica Neue", Helvetica, Arial, sans-serif;
    --mono: "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  }

  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); font: 10.5pt/1.5 var(--sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* Each variant is its own document: a key for variant B is useless stapled to
     the back of variant A's last question. */
  .variant + .variant { break-before: page; page-break-before: always; }

  /* --- header --- */
  .head { border-bottom: 2pt solid var(--ink); padding-bottom: 0.16in; margin-bottom: 0.18in; }
  .head .kicker { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin: 0 0 0.05in; }
  .head h1 { margin: 0 0 0.03in; font-size: 18pt; letter-spacing: -0.01em; }
  .head .course { margin: 0 0 0.12in; font-size: 10pt; color: var(--muted); }
  .head .totals { margin: 0; font-size: 9pt; color: var(--muted); }
  .head .totals strong { color: var(--ink); }
  .head .totals code { font-family: var(--mono); font-size: 8.5pt; }

  .note { background: var(--surface); border-left: 2.5pt solid var(--accent); border-radius: 0 4pt 4pt 0; padding: 7pt 10pt; margin-bottom: 0.22in; font-size: 8.5pt; color: var(--muted); }
  .note p { margin: 0 0 0.04in; }
  .note p:last-child { margin-bottom: 0; }

  /* --- the at-a-glance grid --- */
  .gridhead { font-size: 8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.09in; }
  .grid { column-count: 4; column-gap: 0.26in; margin-bottom: 0.1in; }
  .grid .row {
    break-inside: avoid;
    page-break-inside: avoid;
    display: flex;
    align-items: baseline;
    gap: 0.07in;
    padding: 1.5pt 3pt;
    border-bottom: 0.5pt solid var(--rule);
  }
  .grid .pos { flex: none; width: 0.26in; text-align: right; font-size: 9.5pt; color: var(--muted); }
  .grid .ans { flex: none; min-width: 0.34in; font-family: var(--mono); font-size: 11pt; font-weight: 700; color: var(--ok); letter-spacing: 0.02em; }
  .grid .pts { margin-left: auto; font-size: 8pt; font-weight: 600; color: var(--accent); white-space: nowrap; }

  .ec { margin-top: 0.14in; background: var(--ok-bg); border-radius: 4pt; padding: 7pt 10pt; font-size: 9pt; break-inside: avoid; }
  .ec strong { font-family: var(--mono); letter-spacing: 0.04em; }
  .ec .off { color: var(--muted); }

  /* --- the marked-up paper --- */
  .paperhead { break-before: page; page-break-before: always; font-size: 8pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); border-bottom: 1pt solid var(--ink); padding-bottom: 0.05in; margin: 0 0 0.16in; }

  .q { break-inside: avoid; page-break-inside: avoid; margin-bottom: 0.22in; }
  .qhead { display: flex; align-items: baseline; gap: 0.1in; margin-bottom: 0.08in; }
  .qnum { font-size: 12.5pt; font-weight: 700; color: var(--accent); }
  .qpts { margin-left: auto; font-size: 9pt; font-weight: 600; white-space: nowrap; }

  .prompt { margin-bottom: 0.08in; }
  .prompt > :first-child { margin-top: 0; }
  .prompt > :last-child { margin-bottom: 0; }

  .choices { list-style: none; margin: 0; padding: 0; }
  .choices li { display: flex; gap: 0.09in; align-items: flex-start; padding: 2pt 5pt; border-radius: 3pt; margin: 1pt 0; break-inside: avoid; }
  .choices li.correct { background: var(--ok-bg); }
  .letter { flex: none; width: 0.3in; font-weight: 700; color: var(--muted); }
  .choices li.correct .letter { color: var(--ok); }
  .body > :first-child { margin-top: 0; }
  .body > :last-child { margin-bottom: 0; }

  /* --- markdown --- */
  pre { background: var(--surface); border: 0.5pt solid var(--rule); border-radius: 4pt; padding: 6pt 8pt; margin: 0.07in 0; font: 8.5pt/1.45 var(--mono); white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
  pre code { font: inherit; background: none; padding: 0; }
  ${codeThemeCss('screen')}
  code { font-family: var(--mono); font-size: 0.88em; background: #edf0f3; padding: 0.5pt 2.5pt; border-radius: 2pt; }
  table { border-collapse: collapse; margin: 0.07in 0; font-size: 9.5pt; }
  th, td { border: 0.5pt solid var(--rule); padding: 2.5pt 6pt; text-align: left; }
  th { background: var(--surface); }
  blockquote { margin: 0.07in 0; padding-left: 0.14in; border-left: 2pt solid var(--rule); color: var(--muted); }
  p { margin: 0.05in 0; }
  ul, ol { margin: 0.05in 0; padding-left: 0.22in; }
  img { max-width: 100%; }
`

export function buildKeyShell(katexHref: string | null): string {
  const katex = katexHref ? `<link rel="stylesheet" href="${escapeHtml(katexHref)}">` : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Practice answer key</title>${katex}<style>${KEY_STYLES}</style></head><body></body></html>`
}

export function keyFooter(key: PracticeKey): string {
  return `<div style="width:100%;font:7pt 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#8a919c;padding:0 0.7in;display:flex;justify-content:space-between;">
    <span>${escapeHtml(key.examTitle)} &middot; practice answer key</span>
    <span>Check the version letter against your paper</span>
    <span><span class="pageNumber"></span>/<span class="totalPages"></span></span>
  </div>`
}

/** "A", "A, C and E" — how a position's key reads in prose. */
function lettersInProse(letters: string[]): string {
  if (letters.length < 2) return letters.join('')
  return `${letters.slice(0, -1).join(', ')} and ${letters[letters.length - 1]}`
}

function buildGrid(variant: KeyVariant): string {
  const rows = variant.entries
    .map(
      (e) => `
      <div class="row">
        <span class="pos">${e.position}.</span>
        <span class="ans">${escapeHtml(e.correctLetters.join('') || '—')}</span>
        ${e.points === 1 ? '' : `<span class="pts">${e.points} pts</span>`}
      </div>`,
    )
    .join('')
  return `<div class="grid">${rows}</div>`
}

function buildMarkedPaper(variant: KeyVariant): string {
  return variant.entries
    .map((e) => {
      const choices = e.choices
        .map(
          (c) => `<li class="${c.correct ? 'correct' : ''}">
            <span class="letter">${c.correct ? '&#10003;&nbsp;' : ''}${escapeHtml(c.letter)}.</span>
            <div class="body">${c.html}</div>
          </li>`,
        )
        .join('')

      return `
        <section class="q">
          <div class="qhead">
            <span class="qnum">${e.position}.</span>
            <span class="qpts">${escapeHtml(e.correctLetters.join('') || '—')} &middot; ${e.points} ${e.points === 1 ? 'point' : 'points'}</span>
          </div>
          <div class="prompt">${e.promptHtml}</div>
          <ul class="choices">${choices}</ul>
        </section>`
    })
    .join('')
}

export function buildKeyBody(key: PracticeKey): string {
  return key.variants
    .map((variant) => {
      const totals = keyTotals(variant)
      const ec = key.extraCredit
        ? `<div class="ec">
             <strong>Extra credit</strong> &middot; question ${key.extraCredit.position} on the answer
             sheet &middot; bubble <strong>${escapeHtml(lettersInProse(key.extraCredit.letters))}</strong>
             for +1 point on top of the ${totals.points}.
             ${
               key.extraCredit.onPaper
                 ? ''
                 : '<span class="off">This was not printed on your paper &mdash; it was announced separately.</span>'
             }
           </div>`
        : ''

      return `
        <section class="variant">
          <header class="head">
            <p class="kicker">Practice answer key</p>
            <h1>${escapeHtml(key.examTitle)} ${escapeHtml(variant.label)}</h1>
            <p class="course">${escapeHtml(key.courseName)}</p>
            <p class="totals">
              <strong>${totals.questions}</strong> question${totals.questions === 1 ? '' : 's'} &middot;
              <strong>${totals.points}</strong> point${totals.points === 1 ? '' : 's'} &middot;
              exam code <code>${escapeHtml(variant.traceCode)}</code> &middot;
              generated ${escapeHtml(key.generatedOn)}
            </p>
          </header>

          <div class="note">
            <p><strong>Check the version letter and exam code above against your own paper
            first.</strong> Every version asks the same questions, but in a different order and with
            the choices shuffled, so a key from another version will not line up with what you
            answered.</p>
            <p>The numbers below are the question numbers on your paper, which are also the rows you
            bubbled. Compare each one with what you marked, then read the full question further down
            to see why the answer is what it is.</p>
          </div>

          <p class="gridhead">Answers</p>
          ${buildGrid(variant)}
          ${ec}

          <p class="paperhead">${escapeHtml(variant.label)} &mdash; every question, with the correct answer marked</p>
          ${buildMarkedPaper(variant)}
        </section>`
    })
    .join('')
}
