import { mkdir, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { buildReportBody, buildReportShell, reportFooter, type GradedReport } from './graded-report'
import { stageKatex } from './renderer'

/**
 * Renders graded exam reports. Same page-pool approach as ExamRenderer — each
 * worker loads the shell once so Chromium parses the stylesheet and KaTeX fonts a
 * handful of times per export rather than once per student — but without the
 * bubble-sheet splice or the booklet padding, which a report has no use for.
 */
export class ReportRenderer {
  private constructor(
    private readonly browser: Browser,
    private readonly pages: Page[],
    private readonly idle: Page[],
    private readonly waiting: ((page: Page) => void)[],
  ) {}

  static async launch(options: { shellPath: string; concurrency?: number }): Promise<ReportRenderer> {
    const concurrency = Math.max(1, options.concurrency ?? Math.min(8, availableParallelism()))
    const browser = await chromium.launch()
    const shellUrl = pathToFileURL(options.shellPath).href

    const pages: Page[] = []
    for (let i = 0; i < concurrency; i++) {
      const page = await browser.newPage()
      await page.goto(shellUrl, { waitUntil: 'load' })
      pages.push(page)
    }
    return new ReportRenderer(browser, pages, [...pages], [])
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

  async render(report: GradedReport): Promise<Uint8Array> {
    const page = await this.acquire()
    try {
      await page.evaluate((html) => {
        document.body.innerHTML = html
      }, buildReportBody(report))
      await page.evaluate(() => document.fonts.ready)

      const pdf = await page.pdf({
        format: 'Letter',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: reportFooter(report),
        margin: { top: '0.6in', bottom: '0.75in', left: '0.7in', right: '0.7in' },
      })
      return new Uint8Array(pdf)
    } finally {
      this.release(page)
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.pages.map((p) => p.close().catch(() => {})))
    await this.browser.close()
  }

  get concurrency(): number {
    return this.pages.length
  }
}

/** Writes the report shell next to a copy of KaTeX, so math renders in reports too. */
export async function stageReportAssets(dir: string): Promise<string> {
  const assetsDir = path.join(dir, '.report')
  await mkdir(assetsDir, { recursive: true })
  await stageKatex(assetsDir)
  const shell = path.join(assetsDir, 'shell.html')
  await writeFile(shell, buildReportShell('katex.min.css'), 'utf8')
  return shell
}
