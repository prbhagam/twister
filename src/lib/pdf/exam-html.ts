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

  :root { --ink: #111; --rule: #ccc; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    color: var(--ink);
    font: 11.5pt/1.5 "Times New Roman", Times, serif;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* --- cover page --- */
  .cover { break-after: page; padding-top: 1.2in; }
  .cover h1 { font-size: 22pt; margin: 0 0 0.15in; letter-spacing: 0.01em; }
  .cover .course { font-size: 14pt; color: #333; margin: 0 0 0.5in; }
  .cover .who {
    border: 1pt solid var(--ink);
    padding: 0.22in 0.28in;
    margin-bottom: 0.45in;
  }
  .cover .who dl { display: grid; grid-template-columns: 1.1in 1fr; gap: 0.06in 0.15in; margin: 0; }
  .cover .who dt { font-variant: small-caps; letter-spacing: 0.04em; color: #444; }
  .cover .who dd { margin: 0; font-weight: 600; }
  .cover .instructions { font-size: 11pt; }
  .cover .instructions :first-child { margin-top: 0; }
  .cover .unique {
    margin-top: 0.5in;
    padding-top: 0.14in;
    border-top: 0.5pt solid var(--rule);
    font-size: 9.5pt;
    color: #555;
    font-style: italic;
  }

  /* --- questions --- */
  .question {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0 0 0.28in;
    padding-bottom: 0.08in;
  }
  .question + .question { border-top: 0.5pt solid var(--rule); padding-top: 0.22in; }

  .qhead { display: flex; align-items: baseline; gap: 0.12in; margin-bottom: 0.06in; }
  .qnum { font-weight: 700; font-size: 12pt; min-width: 0.3in; }
  .qpoints { margin-left: auto; font-size: 9pt; color: #666; white-space: nowrap; }

  .prompt { margin: 0 0 0.1in; }
  .prompt > :first-child { margin-top: 0; }
  .prompt > :last-child { margin-bottom: 0; }

  .choices { list-style: none; margin: 0; padding: 0; }
  .choices li { display: flex; gap: 0.11in; margin: 0.04in 0; break-inside: avoid; }
  .choice-letter { font-weight: 700; min-width: 0.19in; }
  .choice-body > :first-child { margin-top: 0; }
  .choice-body > :last-child { margin-bottom: 0; }

  /* --- shared markdown output --- */
  pre {
    background: #f6f8fa;
    border: 0.5pt solid #d8dee4;
    border-radius: 3pt;
    padding: 6pt 8pt;
    margin: 0.07in 0;
    font: 9.5pt/1.4 "SFMono-Regular", Menlo, Consolas, monospace;
    white-space: pre-wrap;
    word-break: break-word;
    break-inside: avoid;
  }
  pre code { font: inherit; background: none; padding: 0; }
  code {
    font: 0.9em/1.3 "SFMono-Regular", Menlo, Consolas, monospace;
    background: #f2f2f2;
    padding: 0.5pt 2.5pt;
    border-radius: 2pt;
  }
  table { border-collapse: collapse; margin: 0.07in 0; font-size: 10.5pt; }
  th, td { border: 0.5pt solid #999; padding: 2.5pt 6pt; text-align: left; }
  th { background: #f2f2f2; }
  img { max-width: 100%; }
  blockquote { margin: 0.07in 0; padding-left: 0.14in; border-left: 2pt solid var(--rule); color: #444; }
  p { margin: 0.06in 0; }
  ul, ol { margin: 0.06in 0; padding-left: 0.24in; }
`

/**
 * The footer identifies the paper on every sheet. If a packet is dropped and the
 * pages are reshuffled, the name, GT ID, and trace code on each page are enough to
 * reassemble it — and the trace code alone recovers the exact layout from the run.
 */
export function footerTemplate(exam: RenderExam): string {
  return `<div style="width:100%;font:8pt 'Helvetica Neue',Arial,sans-serif;color:#666;padding:0 0.75in;display:flex;justify-content:space-between;">
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

  return `
  <section class="cover">
    <h1>${escapeHtml(exam.examTitle)}</h1>
    <p class="course">${escapeHtml(exam.courseName)}</p>
    <div class="who">
      <dl>
        <dt>Name</dt><dd>${escapeHtml(exam.studentName)}</dd>
        <dt>GT ID</dt><dd>${escapeHtml(exam.gtId)}</dd>
        <dt>Exam code</dt><dd>${escapeHtml(exam.traceCode)}</dd>
      </dl>
    </div>
    ${exam.instructionsHtml ? `<div class="instructions">${exam.instructionsHtml}</div>` : ''}
    <p class="unique">
      This exam is unique to you. Its questions, its answer choices, and their order
      differ from every other copy in the room, so answers copied from a neighbour
      will not match your paper. Record all answers on the bubble sheet.
    </p>
  </section>
  ${questions}`
}
