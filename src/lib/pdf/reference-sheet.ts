/**
 * The exam's reference sheet as every PDF prints it: the student booklet, a
 * blank exam, a practice paper and its key, the question bank, and the graded
 * report handed back. One markup and one stylesheet, so it reads the same
 * wherever it appears.
 *
 * Each document's own stylesheet supplies fonts, code blocks, and tables; this
 * only adds the heading and the page break. Greys only, because the booklet is
 * printed on a monochrome laser printer.
 */

export const REFERENCE_SHEET_TITLE = 'Reference sheet'

export const REFERENCE_SHEET_STYLES = String.raw`
  .reference-sheet { break-before: page; }
  .reference-sheet .ref-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.2in;
    margin: 0 0 0.16in;
    padding-bottom: 0.08in;
    border-bottom: 1.5pt solid #333333;
  }
  .reference-sheet .ref-label {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #1a1a1a;
  }
  .reference-sheet .ref-title { font-size: 9pt; color: #5f5f5f; }
  .reference-sheet .ref-body > :first-child { margin-top: 0; }
  .reference-sheet .ref-body > :last-child { margin-bottom: 0; }
`

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/**
 * The sheet as a section that starts on a new page. `html` is the instructor's
 * markdown already rendered; it is trusted, as every authored field is.
 */
export function referenceSheetSection(html: string, examTitle: string): string {
  return `
  <section class="reference-sheet">
    <div class="ref-head">
      <span class="ref-label">${REFERENCE_SHEET_TITLE}</span>
      <span class="ref-title">${escapeHtml(examTitle)}</span>
    </div>
    <div class="ref-body">${html}</div>
  </section>`
}
