import { EXAM_PRINT_PALETTE, codeThemeCss } from '../print-theme'
import { EXTRA_CREDIT_POINTS, formatExtraCreditLetters } from '../extra-credit'
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
  /** Decorative cover line such as "Version Monica". Printed verbatim; omitted
   * when the exam defines no version names. Unrelated to the paper's layout. */
  versionName?: string
  /** Set on a blank exam ("BLANK-07"): a spare paper with no student on it.
   * `studentName` and `gtId` are then empty, and the cover leaves lines for the
   * student to write their own in. */
  blankLabel?: string
  instructionsHtml?: string
  /**
   * The bonus row, printed as its own section after the last question. Present
   * only when the exam has extra credit *and* it is set to appear on the paper —
   * grading does not read this, so leaving it out changes the paper alone.
   */
  extraCredit?: { position: number; letters: string[] }
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
 * Print stylesheet. Three rules matter more than the rest:
 *  - `break-inside: avoid` on each question, so a prompt never splits from its
 *    choices across a page turn.
 *  - `@page` margins sized to leave room for the running footer.
 *  - Grayscale throughout, from PRINT_PALETTE. This is the document that gets run
 *    off a departmental laser printer a few hundred times at a stretch, so every
 *    value here is chosen for toner rather than for a screen.
 */
const STYLES = String.raw`
  @page { size: Letter; margin: 0.7in 0.75in 0.85in 0.75in; }

  :root {${EXAM_PRINT_PALETTE}  }

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
  .cover .rule { width: 2.2in; height: 3pt; background: var(--rule-strong); margin-bottom: 0.28in; }
  .cover h1 {
    font-size: 27pt;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin: 0 0 0.08in;
  }
  .cover .version {
    font-size: 15pt;
    font-weight: 600;
    font-style: italic;
    margin: 0 0 0.1in;
  }
  .cover .course {
    font-size: 12.5pt;
    font-weight: 500;
    color: var(--muted);
    margin: 0 0 0.55in;
  }

  .cover .who {
    background: var(--surface);
    border: 0.5pt solid var(--rule);
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
  .cover .who dd.write-in { border-bottom: 0.75pt solid var(--rule-strong); min-height: 0.3in; }
  .cover .blank-note { font-size: 10pt; color: var(--muted); margin: 0.12in 0 0; }

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
    color: var(--ink);
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

  /* --- extra credit --- */
  /* Rules top and bottom rather than the single hairline that separates questions:
     this is not question 41, and a student skimming for the end of the paper
     should not mistake it for one. */
  .extra-credit {
    break-inside: avoid;
    page-break-inside: avoid;
    margin: 0.3in 0 0;
    padding: 0.16in 0;
    border-top: 1.5pt solid var(--rule-strong);
    border-bottom: 1.5pt solid var(--rule-strong);
  }
  .extra-credit .qhead { margin-bottom: 0.1in; }
  .extra-credit .ec-label {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .extra-credit .ec-body { margin: 0; font-size: 11pt; }
  .extra-credit .ec-letters { font-weight: 700; }
  .extra-credit .ec-note { margin: 0.09in 0 0; font-size: 9.5pt; color: var(--muted); }

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
  /* The letter is what a student carries across to the bubble sheet, so it is the
     last thing that should be set in a soft grey. */
  .choice-letter {
    flex: none;
    width: 0.2in;
    font-weight: 700;
    font-size: 10pt;
    color: var(--ink);
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
  ${codeThemeCss('print')}
  code {
    font-family: var(--mono);
    font-size: 0.88em;
    background: var(--surface);
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
 * Who a paper belongs to, as the footer prints it: the student's name and ID,
 * or on a blank, its label — the only thing that ties a loose blank page back
 * to the paper it came from.
 */
export function paperOwnerLine(exam: Pick<RenderExam, 'studentName' | 'gtId' | 'blankLabel'>): string {
  return exam.blankLabel ?? `${exam.studentName} · ${exam.gtId}`
}

/**
 * The footer identifies the paper on every sheet. If a packet is dropped and the
 * pages are reshuffled, the name, GT ID, and trace code on each page are enough to
 * reassemble it — and the trace code alone recovers the exact layout from the run.
 */
export function footerTemplate(exam: RenderExam): string {
  // Chromium renders header/footer templates in an isolated document that inherits
  // none of the page CSS, so the palette's grey is inlined here by hand. At 7.5pt
  // the old blue-grey was the first thing to break up on a photocopy.
  return `<div style="width:100%;font:7.5pt 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#5f5f5f;letter-spacing:0.02em;padding:0 0.75in;display:flex;justify-content:space-between;">
    <span>${escapeHtml(paperOwnerLine(exam))}</span>
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

function studentWho(exam: RenderExam): string {
  return `<dl>
        <dt>Name</dt><dd>${escapeHtml(exam.studentName)}</dd>
        <dt>ID</dt><dd>${escapeHtml(exam.gtId)}</dd>
        <dt>Exam code</dt><dd class="code">${escapeHtml(exam.traceCode)}</dd>
      </dl>`
}

/** A blank paper's cover: lines for the student's own name and ID, and the
 * blank's label, which the instructor needs to grade it against the right key. */
function blankWho(exam: RenderExam, label: string): string {
  return `<dl>
        <dt>Name</dt><dd class="write-in"></dd>
        <dt>ID</dt><dd class="write-in"></dd>
        <dt>Blank exam</dt><dd class="code">${escapeHtml(label)}</dd>
        <dt>Exam code</dt><dd class="code">${escapeHtml(exam.traceCode)}</dd>
      </dl>
      <p class="blank-note">Write your name and GT ID above, and again in the Name and ID boxes on the bubble sheet.</p>`
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

  // Deliberately after `questions` and outside that list: the bonus is not one of
  // the numbered questions, carries no choices to shuffle, and is identical on
  // every paper. Its row number is the student's own answer sheet, not this page.
  const extraCredit = exam.extraCredit
    ? `
      <section class="extra-credit">
        <div class="qhead">
          <span class="ec-label">Extra credit</span>
          <span class="qpoints">+${EXTRA_CREDIT_POINTS} ${EXTRA_CREDIT_POINTS === 1 ? 'point' : 'points'}</span>
        </div>
        <p class="ec-body">
          On your answer sheet, find question ${exam.extraCredit.position} and bubble
          <span class="ec-letters">${escapeHtml(formatExtraCreditLetters(exam.extraCredit.letters))}</span>.
        </p>
        <p class="ec-note">
          There is nothing to work out here &mdash; the bubbles are the whole question.
          Mark all ${exam.extraCredit.letters.length} and nothing else.
        </p>
      </section>`
    : ''

  // The cover carries the student's identity, the exam code, and nothing else the
  // instructor did not write. Anything describing how the randomization works would
  // be publishing the scheme to the room.
  return `
  <section class="cover">
    <div class="rule"></div>
    <h1>${escapeHtml(exam.examTitle)}</h1>
    ${exam.versionName ? `<p class="version">${escapeHtml(exam.versionName)}</p>` : ''}
    <p class="course">${escapeHtml(exam.courseName)}</p>
    <div class="who">
      ${exam.blankLabel ? blankWho(exam, exam.blankLabel) : studentWho(exam)}
    </div>
    ${exam.instructionsHtml ? `<div class="instructions">${exam.instructionsHtml}</div>` : ''}
  </section>
  ${questions}
  ${extraCredit}`
}
