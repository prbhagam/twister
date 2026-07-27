import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export const BUBBLE_SHEET_PATH = path.join(process.cwd(), 'assets', 'Gradescope Bubble Sheet.pdf')

/**
 * Where to stamp, in PDF user space (origin bottom-left, 612x792 Letter).
 *
 * Derived from the template's own text positions (`pdftotext -bbox`): the "Name"
 * label sits at top-left (71, 64)-(101, 78) and "ID" at (71, 99)-(82, 113), and the
 * field boxes run to x=305. Baselines below are those labels' baselines converted
 * to bottom-up coordinates, so stamped values sit on the same line as their labels.
 *
 * The template is Gradescope's 100-question v2020.05.01 sheet. Its corner fiducial
 * markers are what their scanner registers against, so the page is copied verbatim
 * and only drawn on — never resized, re-encoded, or regenerated.
 */
const FIELD = {
  x: 115,
  maxWidth: 185,
  nameBaseline: 792 - 77.6,
  idBaseline: 792 - 112.6,
  size: 11,
  minSize: 6.5,
} as const

/** Shrinks to fit the field box rather than overflowing into the Version column. */
export function fitText(text: string, font: PDFFont, maxWidth: number, size: number, minSize: number) {
  let current = size
  while (current > minSize && font.widthOfTextAtSize(text, current) > maxWidth) {
    current -= 0.5
  }

  if (font.widthOfTextAtSize(text, current) <= maxWidth) return { text, size: current }

  // Still too wide even at the floor: truncate with an ellipsis.
  let truncated = text
  while (truncated.length > 1 && font.widthOfTextAtSize(`${truncated}…`, current) > maxWidth) {
    truncated = truncated.slice(0, -1)
  }
  return { text: `${truncated}…`, size: current }
}

/**
 * pdf-lib's standard fonts are WinAnsi-encoded and throw on characters outside it.
 * Names in a GT roster do contain accents and occasionally non-Latin scripts, and a
 * throw here would abort the whole run, so unsupported characters are dropped to
 * their closest ASCII form.
 */
export function toWinAnsi(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Draws the student's name and GT ID into the header fields of an already-placed
 * bubble sheet page. Shared by the per-student PDFs and the merged print file so
 * the two can never drift apart.
 */
export function drawStudentFields(
  page: PDFPage,
  font: PDFFont,
  student: { name: string; gtId: string },
): void {
  const ink = rgb(0, 0, 0)

  const name = fitText(toWinAnsi(student.name), font, FIELD.maxWidth, FIELD.size, FIELD.minSize)
  page.drawText(name.text, { x: FIELD.x, y: FIELD.nameBaseline, size: name.size, font, color: ink })

  const id = fitText(toWinAnsi(student.gtId), font, FIELD.maxWidth, FIELD.size, FIELD.minSize)
  page.drawText(id.text, { x: FIELD.x, y: FIELD.idBaseline, size: id.size, font, color: ink })
}

export const SHEET_SIZE: [number, number] = [612, 792]

export class BubbleSheetStamper {
  private constructor(
    private readonly template: PDFDocument,
    private readonly bytes: Uint8Array,
  ) {}

  /** Loads the template once; a 400-student run reuses this instance. */
  static async load(templatePath = BUBBLE_SHEET_PATH): Promise<BubbleSheetStamper> {
    const bytes = new Uint8Array(await readFile(templatePath))
    const template = await PDFDocument.load(bytes)
    if (template.getPageCount() !== 1) {
      throw new Error(`Expected a 1-page bubble sheet template, got ${template.getPageCount()} pages.`)
    }
    return new BubbleSheetStamper(template, bytes)
  }

  /**
   * Copies the template page into `target` as its first page, with the student's
   * name and GT ID stamped into the header fields.
   */
  async prependTo(target: PDFDocument, student: { name: string; gtId: string }): Promise<void> {
    const [page] = await target.copyPages(this.template, [0])
    const font = await target.embedFont(StandardFonts.Helvetica)
    drawStudentFields(page, font, student)
    target.insertPage(0, page)
  }

  /** Standalone stamped sheet — used by the coordinate-verification test. */
  async renderSingle(student: { name: string; gtId: string }): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    await this.prependTo(doc, student)
    return doc.save()
  }

  get templateBytes(): Uint8Array {
    return this.bytes
  }
}
