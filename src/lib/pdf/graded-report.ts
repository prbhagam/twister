import { LETTERS } from '../seed'

export interface ReportChoice {
  letter: string
  html: string
  chosen: boolean
  correct: boolean
}

export interface ReportQuestion {
  /** Position on the bubble sheet — the order this student actually saw. */
  position: number
  /** Which authored question and variation this was, e.g. "12B". Useful when a
   * student disputes a question and you need to find it in the bank. */
  source: string
  promptHtml: string
  choices: ReportChoice[]
  verdict: string
  verdictLabel: string
  awarded: number
  possible: number
  /** What Gradescope read, verbatim — the ground truth behind the verdict. */
  rawResponse: string
  overrideNote?: string
  overridden: boolean
}

export interface GradedReport {
  courseName: string
  examTitle: string
  studentName: string
  identifier: string
  traceCode: string
  gradedOn?: string
  /** Absent when the student had no scanned sheet. */
  score?: { earned: number; possible: number }
  questions: ReportQuestion[]
  /** Set instead of questions when nothing was scanned for this student. */
  noSubmission?: boolean
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

const VERDICT_TONE: Record<string, string> = {
  correct: 'ok',
  incorrect: 'bad',
  blank: 'warn',
  multi: 'warn',
  out_of_range: 'warn',
}

export const REPORT_STYLES = String.raw`
  @page { size: Letter; margin: 0.6in 0.7in 0.75in 0.7in; }

  :root {
    --ink: #16191d;
    --muted: #5c6470;
    --rule: #dfe3e8;
    --ok: #17703f;
    --ok-bg: #e8f5ee;
    --bad: #a3232b;
    --bad-bg: #fdecec;
    --warn: #8a5a00;
    --warn-bg: #fdf3e0;
    --surface: #f6f8fa;
    --sans: "Helvetica Neue", Helvetica, Arial, sans-serif;
    --mono: "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  }

  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); font: 10.5pt/1.5 var(--sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* --- header --- */
  .head { border-bottom: 2pt solid var(--ink); padding-bottom: 0.16in; margin-bottom: 0.24in; }
  .head h1 { margin: 0 0 0.03in; font-size: 17pt; letter-spacing: -0.01em; }
  .head .course { margin: 0 0 0.14in; font-size: 10pt; color: var(--muted); }
  .head dl { display: grid; grid-template-columns: auto 1fr auto; gap: 0.05in 0.22in; margin: 0; align-items: baseline; }
  .head dt { font-size: 7.5pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .head dd { margin: 0; font-size: 11pt; font-weight: 600; }
  .head dd.code { font-family: var(--mono); font-size: 9.5pt; }
  .score { font-size: 15pt; font-weight: 700; white-space: nowrap; }
  .score .pct { font-size: 10pt; font-weight: 500; color: var(--muted); }

  .legend { margin-bottom: 0.2in; font-size: 8.5pt; color: var(--muted); }
  .legend .k { display: inline-block; margin-right: 0.14in; }
  .swatch { display: inline-block; width: 7pt; height: 7pt; border-radius: 2pt; vertical-align: -0.5pt; margin-right: 3pt; }

  /* --- questions --- */
  .q { break-inside: avoid; page-break-inside: avoid; margin-bottom: 0.2in; padding-bottom: 0.14in; border-bottom: 0.5pt solid var(--rule); }
  .q:last-child { border-bottom: none; }
  .qhead { display: flex; align-items: baseline; gap: 0.1in; margin-bottom: 0.07in; }
  .qnum { font-size: 11pt; font-weight: 700; }
  .qsrc { font-family: var(--mono); font-size: 7.5pt; color: var(--muted); }
  .qpts { margin-left: auto; font-size: 9pt; font-weight: 600; white-space: nowrap; }

  .tag { display: inline-block; padding: 0.5pt 4pt; border-radius: 3pt; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.02em; }
  .tag.ok { background: var(--ok-bg); color: var(--ok); }
  .tag.bad { background: var(--bad-bg); color: var(--bad); }
  .tag.warn { background: var(--warn-bg); color: var(--warn); }

  .prompt { margin-bottom: 0.09in; }
  .prompt > :first-child { margin-top: 0; }
  .prompt > :last-child { margin-bottom: 0; }

  .choices { list-style: none; margin: 0; padding: 0; }
  .choices li { display: flex; gap: 0.1in; align-items: flex-start; padding: 2.5pt 5pt; border-radius: 3pt; margin: 1.5pt 0; break-inside: avoid; }
  .choices li.correct { background: var(--ok-bg); }
  .choices li.chosen-wrong { background: var(--bad-bg); }
  .letter { flex: none; width: 0.17in; font-weight: 700; color: var(--muted); }
  .body > :first-child { margin-top: 0; }
  .body > :last-child { margin-bottom: 0; }
  .marks { flex: none; margin-left: auto; display: flex; gap: 3pt; }

  .note { margin-top: 0.06in; font-size: 8.5pt; color: var(--muted); }
  .note code { font-family: var(--mono); }

  /* --- no submission --- */
  .none { margin-top: 1in; text-align: center; }
  .none p { font-size: 12pt; font-weight: 600; margin: 0 0 0.08in; }
  .none span { font-size: 10pt; color: var(--muted); }

  /* --- markdown --- */
  pre { background: var(--surface); border: 0.5pt solid var(--rule); border-radius: 4pt; padding: 6pt 8pt; margin: 0.07in 0; font: 8.5pt/1.45 var(--mono); white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
  pre code { font: inherit; background: none; padding: 0; }
  code { font-family: var(--mono); font-size: 0.88em; background: #edf0f3; padding: 0.5pt 2.5pt; border-radius: 2pt; }
  table { border-collapse: collapse; margin: 0.07in 0; font-size: 9.5pt; }
  th, td { border: 0.5pt solid var(--rule); padding: 2.5pt 6pt; text-align: left; }
  th { background: var(--surface); }
  p { margin: 0.05in 0; }
  ul, ol { margin: 0.05in 0; padding-left: 0.22in; }
  img { max-width: 100%; }
`

export function buildReportShell(katexHref: string | null): string {
  const katex = katexHref ? `<link rel="stylesheet" href="${escapeHtml(katexHref)}">` : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Graded exam</title>${katex}<style>${REPORT_STYLES}</style></head><body></body></html>`
}

export function reportFooter(report: GradedReport): string {
  return `<div style="width:100%;font:7pt 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#8a919c;padding:0 0.7in;display:flex;justify-content:space-between;">
    <span>${escapeHtml(report.studentName)} &middot; ${escapeHtml(report.identifier)}</span>
    <span>${escapeHtml(report.examTitle)} &middot; graded copy</span>
    <span>${escapeHtml(report.traceCode)} &middot; <span class="pageNumber"></span>/<span class="totalPages"></span></span>
  </div>`
}

export function buildReportBody(report: GradedReport): string {
  const pct =
    report.score && report.score.possible > 0
      ? ((report.score.earned / report.score.possible) * 100).toFixed(1)
      : null

  const head = `
    <div class="head">
      <h1>${escapeHtml(report.examTitle)}</h1>
      <p class="course">${escapeHtml(report.courseName)}</p>
      <dl>
        <dt>Name</dt><dd>${escapeHtml(report.studentName)}</dd>
        <dd class="score" rowspan="2">${
          report.score
            ? `${report.score.earned} / ${report.score.possible}${pct ? ` <span class="pct">${pct}%</span>` : ''}`
            : '<span class="pct">no submission</span>'
        }</dd>
        <dt>ID</dt><dd>${escapeHtml(report.identifier)}</dd><dd></dd>
        <dt>Exam code</dt><dd class="code">${escapeHtml(report.traceCode)}</dd><dd></dd>
      </dl>
    </div>`

  if (report.noSubmission) {
    return `${head}
      <div class="none">
        <p>No answer sheet was scanned for this student.</p>
        <span>Their exam was generated and is on record under exam code ${escapeHtml(report.traceCode)}.</span>
      </div>`
  }

  const legend = `
    <p class="legend">
      <span class="k"><span class="swatch" style="background:#e8f5ee"></span>correct answer</span>
      <span class="k"><span class="swatch" style="background:#fdecec"></span>marked, incorrect</span>
      <span class="k">&#9679; marked by student</span>
      <span class="k">&#10003; correct</span>
    </p>`

  const questions = report.questions
    .map((q) => {
      const tone = VERDICT_TONE[q.verdict] ?? 'warn'
      const choices = q.choices
        .map((c) => {
          const cls = c.correct ? 'correct' : c.chosen ? 'chosen-wrong' : ''
          const marks = [
            c.chosen ? '<span class="tag bad" style="background:#eceff3;color:#16191d">&#9679; marked</span>' : '',
            c.correct ? '<span class="tag ok">&#10003; correct</span>' : '',
          ]
            .filter(Boolean)
            .join('')
          return `<li class="${cls}">
            <span class="letter">${escapeHtml(c.letter)}.</span>
            <div class="body">${c.html}</div>
            ${marks ? `<span class="marks">${marks}</span>` : ''}
          </li>`
        })
        .join('')

      const notes: string[] = []
      notes.push(`Scanned as <code>${escapeHtml(q.rawResponse || '(blank)')}</code>`)
      if (q.overridden) {
        notes.push(
          `score set by hand${q.overrideNote ? `: ${escapeHtml(q.overrideNote)}` : ''}`,
        )
      }

      return `
        <section class="q">
          <div class="qhead">
            <span class="qnum">${q.position}.</span>
            <span class="qsrc">${escapeHtml(q.source)}</span>
            <span class="tag ${tone}">${escapeHtml(q.verdictLabel)}</span>
            <span class="qpts">${q.awarded} / ${q.possible}</span>
          </div>
          <div class="prompt">${q.promptHtml}</div>
          <ul class="choices">${choices}</ul>
          <p class="note">${notes.join(' &middot; ')}</p>
        </section>`
    })
    .join('')

  return `${head}${legend}${questions}`
}

/** Letters are fixed A–E; exposed so callers build choices in printed order. */
export { LETTERS }
