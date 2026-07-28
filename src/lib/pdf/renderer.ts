import { cp, mkdir, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { chromium, type Browser, type Page } from 'playwright'
import {
  BUBBLE_SHEET_PATH,
  BubbleSheetStamper,
  SHEET_SIZE,
  drawStudentFields,
  toWinAnsi,
} from './bubble-sheet'
import { buildExamBody, buildShellHtml, footerTemplate, headerTemplate, type RenderExam } from './exam-html'

const KATEX_DIST = path.join(process.cwd(), 'node_modules', 'katex', 'dist')

/**
 * Stages the stylesheet shell next to a copy of KaTeX's CSS and fonts, so the page
 * can be loaded over file:// and KaTeX's relative font URLs resolve. Inlining the
 * ~1 MB of woff2 into every student's HTML instead would dominate the run.
 */
export async function stageKatex(assetsDir: string): Promise<void> {
  await cp(path.join(KATEX_DIST, 'katex.min.css'), path.join(assetsDir, 'katex.min.css'))
  await cp(path.join(KATEX_DIST, 'fonts'), path.join(assetsDir, 'fonts'), { recursive: true })
}

export async function stageRenderAssets(dir: string): Promise<string> {
  const assetsDir = path.join(dir, '.render')
  await mkdir(assetsDir, { recursive: true })
  await stageKatex(assetsDir)

  const shell = path.join(assetsDir, 'shell.html')
  await writeFile(shell, buildShellHtml('katex.min.css'), 'utf8')
  return shell
}

export interface RenderedExam {
  pdf: Uint8Array
  pageCount: number
}

/**
 * Puts a blank page behind the bubble sheet so it occupies a whole sheet alone.
 *
 * Students tear the scantron off the packet before starting. Printed duplex, page 2
 * lands on the back of page 1, so without this the cover page leaves with the
 * scantron — and whatever is on the back gets scanned along with it.
 *
 * Deliberately empty: no footer, no notice. Anything printed here could end up in
 * the scan and interfere with how Gradescope registers the sheet.
 */
export function addScantronBackPage(doc: PDFDocument): void {
  doc.insertPage(1, doc.addPage(SHEET_SIZE))
  // addPage appended a second copy; drop it, keeping only the inserted one.
  doc.removePage(doc.getPageCount() - 1)
}

/**
 * Appends a filler page when a booklet would otherwise end on an odd page.
 *
 * Without this, printing the merged file double-sided puts the *next* student's
 * bubble sheet on the back of this student's last page. Every booklet ending on an
 * even page guarantees each one starts on a fresh sheet.
 *
 * The page says so explicitly rather than being blank, so nobody thinks their
 * booklet was misprinted, and it carries the same footer so a loose sheet can still
 * be traced back to its owner.
 */
export async function padBooklet(doc: PDFDocument, exam: RenderExam): Promise<void> {
  if (doc.getPageCount() % 2 === 0) return

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage(SHEET_SIZE)
  const [width, height] = SHEET_SIZE

  const notice = 'This page is intentionally blank.'
  const noticeSize = 11
  page.drawText(notice, {
    x: (width - font.widthOfTextAtSize(notice, noticeSize)) / 2,
    y: height / 2,
    size: noticeSize,
    font,
    color: rgb(0.42, 0.45, 0.5),
  })

  // Same three-part footer the rendered pages carry.
  const footerSize = 7.5
  const footer = rgb(0.54, 0.57, 0.61)
  const margin = 54
  page.drawText(`${toWinAnsi(exam.studentName)} · ${toWinAnsi(exam.gtId)}`, {
    x: margin,
    y: 40,
    size: footerSize,
    font,
    color: footer,
  })
  const trace = toWinAnsi(exam.traceCode)
  page.drawText(trace, {
    x: width - margin - font.widthOfTextAtSize(trace, footerSize),
    y: 40,
    size: footerSize,
    font,
    color: footer,
  })
}

/**
 * Renders exam PDFs: HTML body via headless Chromium, then the untouched
 * bubble-sheet page spliced in front with pdf-lib.
 */
export class ExamRenderer {
  private constructor(
    private readonly browser: Browser,
    private readonly pages: Page[],
    private readonly stamper: BubbleSheetStamper,
    private readonly idle: Page[],
    private readonly waiting: ((page: Page) => void)[],
  ) {}

  static async launch(options: { shellPath: string; concurrency?: number }): Promise<ExamRenderer> {
    const concurrency = Math.max(1, options.concurrency ?? Math.min(8, availableParallelism()))
    const browser = await chromium.launch()
    const stamper = await BubbleSheetStamper.load()
    const shellUrl = pathToFileURL(options.shellPath).href

    const pages: Page[] = []
    for (let i = 0; i < concurrency; i++) {
      const page = await browser.newPage()
      await page.goto(shellUrl, { waitUntil: 'load' })
      pages.push(page)
    }

    return new ExamRenderer(browser, pages, stamper, [...pages], [])
  }

  private async acquire(): Promise<Page> {
    const free = this.idle.pop()
    if (free) return free
    return new Promise<Page>((resolve) => this.waiting.push(resolve))
  }

  private release(page: Page) {
    const next = this.waiting.shift()
    if (next) next(page)
    else this.idle.push(page)
  }

  async render(exam: RenderExam): Promise<RenderedExam> {
    const page = await this.acquire()
    let bodyPdf: Buffer
    try {
      // Swapping innerHTML on the already-loaded shell reuses the parsed stylesheet
      // and the KaTeX fonts already resident in this page.
      await page.evaluate((html) => {
        document.body.innerHTML = html
      }, buildExamBody(exam))
      await page.evaluate(() => document.fonts.ready)

      bodyPdf = await page.pdf({
        format: 'Letter',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: headerTemplate(),
        footerTemplate: footerTemplate(exam),
        margin: { top: '0.7in', bottom: '0.85in', left: '0.75in', right: '0.75in' },
      })
    } finally {
      this.release(page)
    }

    const doc = await PDFDocument.load(bodyPdf)
    await this.stamper.prependTo(doc, { name: exam.studentName, gtId: exam.gtId })
    addScantronBackPage(doc)
    await padBooklet(doc, exam)

    return { pdf: await doc.save(), pageCount: doc.getPageCount() }
  }

  async close(): Promise<void> {
    await Promise.all(this.pages.map((p) => p.close().catch(() => {})))
    await this.browser.close()
  }

  get concurrency(): number {
    return this.pages.length
  }
}

/**
 * Builds the single print job from the per-student PDFs.
 *
 * The bubble sheet's vector artwork is embedded **once** and drawn onto each
 * student's first page, rather than copied per student. Copying it 404 times is
 * what made an early version of this file 177 MB; sharing the XObject roughly
 * halves it. Each student's own PDF still carries its own full copy — that file is
 * handed out individually.
 *
 * Source files are read one at a time so a full class never sits in memory at once.
 */
export async function buildPrintFile(params: {
  students: { path: string; name: string; gtId: string }[]
  onProgress?: (done: number) => void
}): Promise<Uint8Array> {
  const { readFile } = await import('node:fs/promises')
  const merged = await PDFDocument.create()

  const templateBytes = new Uint8Array(await readFile(BUBBLE_SHEET_PATH))
  const [sheet] = await merged.embedPdf(templateBytes, [0])
  const font = await merged.embedFont(StandardFonts.Helvetica)

  for (const [i, student] of params.students.entries()) {
    const page = merged.addPage(SHEET_SIZE)
    page.drawPage(sheet, { x: 0, y: 0, width: SHEET_SIZE[0], height: SHEET_SIZE[1] })
    drawStudentFields(page, font, student)

    // Skip index 0: that is the student file's own bubble sheet, already replaced
    // by the shared one above.
    const doc = await PDFDocument.load(new Uint8Array(await readFile(student.path)))
    const bodyIndices = doc.getPageIndices().slice(1)
    const bodyPages = await merged.copyPages(doc, bodyIndices)
    for (const bodyPage of bodyPages) merged.addPage(bodyPage)

    params.onProgress?.(i + 1)
  }

  return merged.save()
}
