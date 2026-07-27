import { LETTERS } from '../seed'

export interface RenderQuestion {
  position: number
  points: number
  promptHtml: string
  /** Already in printed order: index 0 is choice A. */
  choicesHtml: string[]
}

export interface RenderExam {
  examTitle: string
  courseName: string
  studentName: string
  gtId: string
  traceCode: string
  instructionsHtml?: string
  questions: RenderQuestion[]
  /** Relative href to katex.min.css, or null when the exam uses no math. */
  katexHref: string | null
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/**
 * Print stylesheet. Two rules matter more than the rest:
 *  - `break-inside: avoid` on each question, so a prompt never splits from its
 *    choices across a page turn.
 *  - `@page` margins sized to leave room for the running footer.
 */
const STYLES = String.raw`
  @page { size: Letter; margin: 0.7in 0.75in 0.85in 0.75in; }

  :root {
    --ink: #16191d;
    --muted: #5c6470;
    --rule: #d9dde3;
    --accent: #1c3f94;
    --surface: #f5f7fa;
    --sans: "Helvetica Neue", Helvetica, Arial, "Segoe UI", system-ui, sans-serif;
    --mono: "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    color: var(--ink);
    font: 11pt/1.55 var(--sans);
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* --- cover page --- */
  .cover { break-after: page; padding-top: 0.9in; }
  .cover .rule { width: 2.2in; height: 3pt; background: var(--accent); margin-bottom: 0.28in; }
  .cover h1 {
    font-size: 27pt;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 0 0 0.08in;
  }
  .cover .course {
    font-size: 12.5pt;
    font-weight: 500;
    color: var(--muted);
    margin: 0 0 0.55in;
  }

  .cover .who {
    background: var(--surface);
    border-radius: 6pt;
    padding: 0.26in 0.3in;
    margin-bottom: 0.45in;
  }
  .cover .who dl {
    display: grid;
    grid-template-columns: 0.95in 1fr;
    gap: 0.11in 0.2in;
    margin: 0;
  }
  .cover .who dt {
    font-size: 8pt;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
    align-self: center;
  }
  .cover .who dd {
    margin: 0;
    font-size: 12pt;
    font-weight: 600;
  }
  .cover .who dd.code { font-family: var(--mono); font-size: 10.5pt; letter-spacing: 0.06em; }

  .cover .instructions { font-size: 10.5pt; line-height: 1.6; }
  .cover .instructions > :first-child { margin-top: 0; }
  .cover .instructions > :last-child { margin-bottom: 0; }

  /* --- questions --- */
  .question {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 0 0.26in;
  }
  .question + .question { border-top: 0.5pt solid var(--rule); padding-top: 0.24in; }

  .qhead { display: flex; align-items: baseline; gap: 0.12in; margin-bottom: 0.09in; }
  .qnum {
    font-size: 12pt;
    font-weight: 700;
    color: var(--accent);
    min-width: 0.28in;
    letter-spacing: -0.01em;
  }
  .qpoints {
    margin-left: auto;
    font-size: 8pt;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
    white-space: nowrap;
  }

  .prompt { margin: 0 0 0.13in; }
  .prompt > :first-child { margin-top: 0; }
  .prompt > :last-child { margin-bottom: 0; }

  .choices { list-style: none; margin: 0; padding: 0; }
  .choices li {
    display: flex;
    gap: 0.13in;
    align-items: flex-start;
    margin: 0.055in 0;
    break-inside: avoid;
  }
  .choice-letter {
    flex: none;
    width: 0.2in;
    font-weight: 700;
    font-size: 10pt;
    color: var(--muted);
    line-height: 1.55;
  }
  .choice-body > :first-child { margin-top: 0; }
  .choice-body > :last-child { margin-bottom: 0; }

  /* --- shared markdown output --- */
  pre {
    background: var(--surface);
    border: 0.5pt solid var(--rule);
    border-radius: 5pt;
    padding: 8pt 10pt;
    margin: 0.1in 0;
    font: 9pt/1.5 var(--mono);
    white-space: pre-wrap;
    word-break: break-word;
    break-inside: avoid;
  }
  pre code { font: inherit; background: none; padding: 0; }
  code {
    font-family: var(--mono);
    font-size: 0.88em;
    background: #eceff3;
    padding: 1pt 3pt;
    border-radius: 3pt;
  }
  table {
    border-collapse: collapse;
    margin: 0.1in 0;
    font-size: 10pt;
    break-inside: avoid;
  }
  th, td { border: 0.5pt solid var(--rule); padding: 3.5pt 8pt; text-align: left; }
  th { background: var(--surface); font-weight: 600; }
  img { max-width: 100%; }
  blockquote {
    margin: 0.1in 0;
    padding-left: 0.16in;
    border-left: 2pt solid var(--rule);
    color: var(--muted);
  }
  p { margin: 0.07in 0; }
  ul, ol { margin: 0.07in 0; padding-left: 0.26in; }
`

/**
 * The footer identifies the paper on every sheet. If a packet is dropped and the
 * pages are reshuffled, the name, GT ID, and trace code on each page are enough to
 * reassemble it — and the trace code alone recovers the exact layout from the run.
 */
export function footerTemplate(exam: RenderExam): string {
  return `<div style="width:100%;font:7.5pt 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#8a919c;letter-spacing:0.02em;padding:0 0.75in;display:flex;justify-content:space-between;">
    <span>${escapeHtml(exam.studentName)} &middot; ${escapeHtml(exam.gtId)}</span>
    <span>${escapeHtml(exam.examTitle)}</span>
    <span>${escapeHtml(exam.traceCode)} &middot; <span class="pageNumber"></span>/<span class="totalPages"></span></span>
  </div>`
}

export function headerTemplate(): string {
  // Chromium requires a header template when displayHeaderFooter is on; an empty
  // one keeps the top margin clean.
  return '<div></div>'
}

/**
 * An empty page carrying only the stylesheet and the KaTeX font link.
 *
 * Each render worker loads this once from disk and then swaps only the body per
 * student, so Chromium parses the CSS and loads the KaTeX web fonts a handful of
 * times per run instead of 404 times.
 */
export function buildShellHtml(katexHref: string | null): string {
  const katexLink = katexHref ? `<link rel="stylesheet" href="${escapeHtml(katexHref)}">` : ''
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>TWISTER</title>${katexLink}<style>${STYLES}</style></head>
<body></body>
</html>`
}

export function buildExamBody(exam: RenderExam): string {
  const questions = exam.questions
    .map(
      (q) => `
      <section class="question">
        <div class="qhead">
          <span class="qnum">${q.position}.</span>
          <span class="qpoints">${q.points} ${q.points === 1 ? 'point' : 'points'}</span>
        </div>
        <div class="prompt">${q.promptHtml}</div>
        <ol class="choices">
          ${q.choicesHtml
            .map(
              (choice, i) => `<li>
                <span class="choice-letter">${LETTERS[i]}.</span>
                <div class="choice-body">${choice}</div>
              </li>`,
            )
            .join('')}
        </ol>
      </section>`,
    )
    .join('')

  // The cover carries the student's identity, the exam code, and nothing else the
  // instructor did not write. Anything describing how the randomization works would
  // be publishing the scheme to the room.
  return `
  <section class="cover">
    <div class="rule"></div>
    <h1>${escapeHtml(exam.examTitle)}</h1>
    <p class="course">${escapeHtml(exam.courseName)}</p>
    <div class="who">
      <dl>
        <dt>Name</dt><dd>${escapeHtml(exam.studentName)}</dd>
        <dt>ID</dt><dd>${escapeHtml(exam.gtId)}</dd>
        <dt>Exam code</dt><dd class="code">${escapeHtml(exam.traceCode)}</dd>
      </dl>
    </div>
    ${exam.instructionsHtml ? `<div class="instructions">${exam.instructionsHtml}</div>` : ''}
  </section>
  ${questions}`
}
