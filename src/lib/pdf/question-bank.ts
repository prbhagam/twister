export interface BankChoice {
  /** Authoring position, 1-based — the same number the CSV calls `choice_1`. */
  number: number
  html: string
  correct: boolean
  pinToLast: boolean
}

export interface BankVariation {
  /** The variation's own label, "A", "B", … as authored. */
  label: string
  promptHtml: string
  choices: BankChoice[]
}

export interface BankQuestion {
  /** Position in the exam, as authored. Students see a permuted order. */
  order: number
  /** Internal label, never printed on a student's paper. */
  title?: string | null
  points: number
  status: string
  /** "Select all that apply": a variation may legitimately mark more than one
   * choice correct. */
  allowMultipleCorrect: boolean
  variations: BankVariation[]
}

export interface QuestionBank {
  courseName: string
  examTitle: string
  generatedOn: string
  questions: BankQuestion[]
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

export function bankTotals(bank: QuestionBank): { questions: number; variations: number; points: number } {
  return {
    questions: bank.questions.length,
    variations: bank.questions.reduce((n, q) => n + q.variations.length, 0),
    points: bank.questions.reduce((n, q) => n + q.points, 0),
  }
}

/**
 * Print styles for the bank. Unlike a student's paper this is a reference document,
 * so it keeps a variation with its prompt and choices via `break-inside: avoid` at
 * the *variation* level rather than the question level — a question with five long
 * variations will not fit on one page and forcing it to try wastes most of one.
 */
export const BANK_STYLES = String.raw`
  @page { size: Letter; margin: 0.6in 0.7in 0.75in 0.7in; }

  :root {
    --ink: #16191d;
    --muted: #5c6470;
    --rule: #dfe3e8;
    --accent: #1c3f94;
    --ok: #17703f;
    --ok-bg: #e8f5ee;
    --warn: #8a5a00;
    --warn-bg: #fdf3e0;
    --surface: #f6f8fa;
    --sans: "Helvetica Neue", Helvetica, Arial, sans-serif;
    --mono: "SF Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  }

  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); font: 10.5pt/1.5 var(--sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  /* --- header --- */
  .head { border-bottom: 2pt solid var(--ink); padding-bottom: 0.16in; margin-bottom: 0.18in; }
  .head .kicker { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); margin: 0 0 0.05in; }
  .head h1 { margin: 0 0 0.03in; font-size: 18pt; letter-spacing: -0.01em; }
  .head .course { margin: 0 0 0.12in; font-size: 10pt; color: var(--muted); }
  .head .totals { margin: 0; font-size: 9pt; color: var(--muted); }
  .head .totals strong { color: var(--ink); }

  .note { background: var(--surface); border-left: 2.5pt solid var(--accent); border-radius: 0 4pt 4pt 0; padding: 7pt 10pt; margin-bottom: 0.22in; font-size: 8.5pt; color: var(--muted); }
  .note p { margin: 0 0 0.04in; }
  .note p:last-child { margin-bottom: 0; }

  /* --- question --- */
  .q { margin-bottom: 0.26in; }
  .qhead { display: flex; align-items: baseline; gap: 0.1in; border-bottom: 1pt solid var(--ink); padding-bottom: 0.05in; margin-bottom: 0.12in; break-after: avoid; page-break-after: avoid; }
  .qnum { font-size: 12.5pt; font-weight: 700; color: var(--accent); }
  .qtitle { font-size: 9.5pt; color: var(--muted); font-style: italic; }
  .qmeta { margin-left: auto; display: flex; align-items: baseline; gap: 0.08in; white-space: nowrap; }
  .qpts { font-size: 9pt; font-weight: 600; }

  .tag { display: inline-block; padding: 0.5pt 4pt; border-radius: 3pt; font-size: 7.5pt; font-weight: 600; letter-spacing: 0.02em; }
  .tag.ok { background: var(--ok-bg); color: var(--ok); }
  .tag.warn { background: var(--warn-bg); color: var(--warn); }
  .tag.plain { background: #eceff3; color: var(--muted); }

  /* --- variation --- */
  .v { break-inside: avoid; page-break-inside: avoid; margin: 0 0 0.16in 0; padding-left: 0.14in; border-left: 2pt solid var(--rule); }
  .vhead { display: flex; align-items: baseline; gap: 0.08in; margin-bottom: 0.06in; }
  .vlabel { font-size: 9pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }

  .prompt { margin-bottom: 0.08in; }
  .prompt > :first-child { margin-top: 0; }
  .prompt > :last-child { margin-bottom: 0; }
  .prompt.empty { color: #a3232b; font-style: italic; }

  .choices { list-style: none; margin: 0; padding: 0; }
  .choices li { display: flex; gap: 0.09in; align-items: flex-start; padding: 2pt 5pt; border-radius: 3pt; margin: 1pt 0; break-inside: avoid; }
  .choices li.correct { background: var(--ok-bg); }
  .num { flex: none; width: 0.17in; font-weight: 700; color: var(--muted); }
  .body > :first-child { margin-top: 0; }
  .body > :last-child { margin-bottom: 0; }
  .marks { flex: none; margin-left: auto; display: flex; gap: 3pt; }

  /* --- markdown --- */
  pre { background: var(--surface); border: 0.5pt solid var(--rule); border-radius: 4pt; padding: 6pt 8pt; margin: 0.07in 0; font: 8.5pt/1.45 var(--mono); white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
  pre code { font: inherit; background: none; padding: 0; }
  code { font-family: var(--mono); font-size: 0.88em; background: #edf0f3; padding: 0.5pt 2.5pt; border-radius: 2pt; }
  table { border-collapse: collapse; margin: 0.07in 0; font-size: 9.5pt; }
  th, td { border: 0.5pt solid var(--rule); padding: 2.5pt 6pt; text-align: left; }
  th { background: var(--surface); }
  blockquote { margin: 0.07in 0; padding-left: 0.14in; border-left: 2pt solid var(--rule); color: var(--muted); }
  p { margin: 0.05in 0; }
  ul, ol { margin: 0.05in 0; padding-left: 0.22in; }
  img { max-width: 100%; }
`

export function buildBankShell(katexHref: string | null): string {
  const katex = katexHref ? `<link rel="stylesheet" href="${escapeHtml(katexHref)}">` : ''
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Question bank</title>${katex}<style>${BANK_STYLES}</style></head><body></body></html>`
}

export function bankFooter(bank: QuestionBank): string {
  return `<div style="width:100%;font:7pt 'Helvetica Neue',Helvetica,Arial,sans-serif;color:#8a919c;padding:0 0.7in;display:flex;justify-content:space-between;">
    <span>${escapeHtml(bank.examTitle)} &middot; question bank</span>
    <span>Instructor copy &mdash; contains answers</span>
    <span><span class="pageNumber"></span>/<span class="totalPages"></span></span>
  </div>`
}

export function buildBankBody(bank: QuestionBank): string {
  const totals = bankTotals(bank)

  const head = `
    <div class="head">
      <p class="kicker">Question bank &middot; instructor copy</p>
      <h1>${escapeHtml(bank.examTitle)}</h1>
      <p class="course">${escapeHtml(bank.courseName)}</p>
      <p class="totals">
        <strong>${totals.questions}</strong> question${totals.questions === 1 ? '' : 's'} &middot;
        <strong>${totals.variations}</strong> variation${totals.variations === 1 ? '' : 's'} &middot;
        <strong>${totals.points}</strong> point${totals.points === 1 ? '' : 's'} &middot;
        generated ${escapeHtml(bank.generatedOn)}
      </p>
    </div>`

  // Without this, the numbers below read as the letters on a student's sheet, and
  // "the answer to 7 is 3" would be repeated back as an answer key that is wrong
  // for every student.
  const note = `
    <div class="note">
      <p><strong>Correct answers are marked.</strong> Do not hand this out.</p>
      <p>Choices are listed in authoring order and numbered 1&ndash;${Math.max(
        1,
        ...bank.questions.flatMap((q) => q.variations.map((v) => v.choices.length)),
      )}, matching the <code>choice_n</code> columns of the question CSV. On a printed
      paper each student gets one variation per question, with the choices shuffled into
      A&ndash;E and the questions themselves reordered, so these numbers are not the letters
      any student sees.</p>
    </div>`

  const questions = bank.questions
    .map((q) => {
      const variations = q.variations.length
        ? q.variations
            .map((v) => {
              const choices = v.choices
                .map((c) => {
                  const marks = [
                    c.correct ? '<span class="tag ok">&#10003; correct</span>' : '',
                    c.pinToLast ? '<span class="tag plain">pinned last</span>' : '',
                  ]
                    .filter(Boolean)
                    .join('')
                  return `<li class="${c.correct ? 'correct' : ''}">
                    <span class="num">${c.number}.</span>
                    <div class="body">${c.html || '<em>(empty choice)</em>'}</div>
                    ${marks ? `<span class="marks">${marks}</span>` : ''}
                  </li>`
                })
                .join('')
              const correctCount = v.choices.filter((c) => c.correct).length
              const flag =
                correctCount === 0
                  ? '<span class="tag warn">no correct answer</span>'
                  : correctCount > 1
                    ? q.allowMultipleCorrect
                      ? `<span class="tag ok">${correctCount} correct answers</span>`
                      : `<span class="tag warn">${correctCount} correct answers</span>`
                    : ''
              return `
                <section class="v">
                  <div class="vhead">
                    <span class="vlabel">Variation ${escapeHtml(v.label)}</span>
                    <span class="tag plain">${v.choices.length} choice${v.choices.length === 1 ? '' : 's'}</span>
                    ${flag}
                  </div>
                  <div class="prompt${v.promptHtml.trim() ? '' : ' empty'}">${v.promptHtml.trim() || 'Empty prompt.'}</div>
                  <ul class="choices">${choices}</ul>
                </section>`
            })
            .join('')
        : '<p class="prompt empty">This question has no variations.</p>'

      return `
        <section class="q">
          <div class="qhead">
            <span class="qnum">Question ${q.order}</span>
            ${q.title ? `<span class="qtitle">${escapeHtml(q.title)}</span>` : ''}
            <span class="qmeta">
              <span class="tag plain">${q.variations.length} variation${q.variations.length === 1 ? '' : 's'}</span>
              ${q.allowMultipleCorrect ? '<span class="tag plain">select all that apply</span>' : ''}
              <span class="tag ${q.status === 'APPROVED' ? 'ok' : 'warn'}">${escapeHtml(q.status.toLowerCase().replace(/_/g, ' '))}</span>
              <span class="qpts">${q.points} pt${q.points === 1 ? '' : 's'}</span>
            </span>
          </div>
          ${variations}
        </section>`
    })
    .join('')

  return `${head}${note}${questions || '<p class="prompt empty">This exam has no questions yet.</p>'}`
}
