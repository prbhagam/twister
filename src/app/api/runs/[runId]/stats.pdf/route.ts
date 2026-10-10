import { chromium } from 'playwright'
import { authorizeRunApi } from '@/lib/authorization'
import { loadRunStats } from '@/lib/stats-data'
import { statsReportHtml } from '@/lib/stats-report'

/**
 * The statistics page as a printable PDF. Aggregate only — no student names or
 * identifiers — so it can be shared with TAs or a course coordinator.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  if (!await authorizeRunApi(runId, 'grade:view')) return new Response('Not found', { status: 404 })
  const { stats, courseName, examTitle, runLabel, filename } = await loadRunStats(runId)
  if (!stats.percent) return new Response('This run has no graded students.', { status: 404 })

  const html = statsReportHtml({ stats, courseName, examTitle, runLabel, filename, generatedAt: new Date() })
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate:
        '<div style="width:100%;font:8px Helvetica,Arial,sans-serif;color:#64748b;padding:0 0.6in;display:flex;justify-content:space-between">' +
        `<span>${escapeHtml(examTitle)} · statistics</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: '0.6in', bottom: '0.7in', left: '0.6in', right: '0.6in' },
    })
    const slug = (examTitle || 'exam').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '')
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${slug}-statistics.pdf"`,
        'cache-control': 'no-store',
      },
    })
  } finally {
    await browser.close()
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
