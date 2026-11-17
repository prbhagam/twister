import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { buildReferenceSheetBody, buildShellHtml, referenceSheetFooter, type RenderExam } from './exam-html'
import { buildBankBody, type QuestionBank } from './question-bank'
import { buildKeyBody, type PracticeKey } from './practice-key'
import { buildReportBody, type GradedReport } from './graded-report'
import { appendReferenceSheet, padBooklet } from './renderer'
import { REFERENCE_SHEET_TITLE } from './reference-sheet'

const exam: RenderExam = {
  examTitle: 'Exam 2',
  courseName: 'CS 1301',
  studentName: 'Nadia Abbott',
  gtId: '903000101',
  traceCode: 'ABC123',
  questions: [],
  katexHref: null,
}

const SHEET = '<h3>grades.txt</h3><pre><code>Ross,88\nRachel,92</code></pre>'

// Distinct page sizes stand in for page content, so the finished booklet can be
// read back as a sequence: Q for the student's own pages, R for the reference
// sheet, and F for the filler pages the renderer adds (always US Letter).
const QUESTION_PAGE: [number, number] = [600, 780]
const SHEET_PAGE: [number, number] = [601, 781]

async function documentOf(pages: number, size: [number, number]) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage(size)
  return doc
}

function sequence(doc: PDFDocument): string {
  return doc
    .getPages()
    .map((page) => {
      const { width } = page.getSize()
      return width === QUESTION_PAGE[0] ? 'Q' : width === SHEET_PAGE[0] ? 'R' : 'F'
    })
    .join('')
}

/** Booklet so far (bubble sheet, its blank back, then the body) plus the sheet. */
async function finished(bookletPages: number, sheetPages: number): Promise<string> {
  const doc = await documentOf(bookletPages, QUESTION_PAGE)
  await appendReferenceSheet(doc, await documentOf(sheetPages, SHEET_PAGE), exam)
  await padBooklet(doc, exam)
  return sequence(doc)
}

describe('appendReferenceSheet', () => {
  it('starts on the front of a fresh sheet after a booklet that ends on a back', async () => {
    // Six pages: the last is a back, so the next page is already a front.
    expect(await finished(6, 1)).toBe('QQQQQQRF')
  })

  it('puts a filler first when the booklet ends on a front', async () => {
    // Without it the reference sheet would print on the back of the last
    // question page, and tearing it off would take that page with it.
    expect(await finished(7, 1)).toBe('QQQQQQQFRF')
  })

  it('always starts the sheet on an odd page and keeps the blank back cover', async () => {
    for (let booklet = 2; booklet <= 12; booklet++) {
      for (let sheet = 1; sheet <= 3; sheet++) {
        const pages = await finished(booklet, sheet)
        const start = pages.indexOf('R')
        expect(start % 2, `${booklet}+${sheet}: ${pages}`).toBe(0) // 0-based even = odd page
        expect(pages.slice(start, start + sheet)).toBe('R'.repeat(sheet))
        expect(pages.length % 2).toBe(0)
        expect(pages.at(-1)).toBe('F')
        // Never more than one filler between the questions and the sheet.
        expect(pages.slice(booklet, start).length).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('reference sheet markup', () => {
  it('heads the sheet and names the exam, but no student', () => {
    const body = buildReferenceSheetBody(SHEET, 'Exam 2 <B>')
    expect(body).toContain(REFERENCE_SHEET_TITLE)
    expect(body).toContain('Exam 2 &lt;B&gt;')
    expect(body).toContain(SHEET)
    const footer = referenceSheetFooter('Exam 2')
    expect(footer).toContain(REFERENCE_SHEET_TITLE)
    expect(footer).not.toContain(exam.studentName)
    expect(footer).toContain('pageNumber')
  })

  it('carries its page break in the booklet stylesheet', () => {
    expect(buildShellHtml(null)).toContain('.reference-sheet { break-before: page; }')
  })

  const bank: QuestionBank = { courseName: 'CS 1301', examTitle: 'Exam 2', generatedOn: '2026-11-16', questions: [] }
  const key: PracticeKey = { courseName: 'CS 1301', examTitle: 'Exam 2', generatedOn: '2026-11-16', variants: [] }
  const report: GradedReport = {
    courseName: 'CS 1301',
    examTitle: 'Exam 2',
    studentName: 'Nadia Abbott',
    identifier: '903000101',
    traceCode: 'ABC123',
    score: { earned: 1, possible: 1 },
    questions: [],
  }

  it('is appended to the question bank, practice key, and graded report when set', () => {
    for (const body of [
      buildBankBody({ ...bank, referenceSheetHtml: SHEET }),
      buildKeyBody({ ...key, referenceSheetHtml: SHEET }),
      buildReportBody({ ...report, referenceSheetHtml: SHEET }),
    ]) {
      expect(body).toContain('class="reference-sheet"')
      expect(body).toContain(SHEET)
    }
  })

  it('is absent from each when the exam has none', () => {
    for (const body of [buildBankBody(bank), buildKeyBody(key), buildReportBody(report)]) {
      expect(body).not.toContain('class="reference-sheet"')
    }
  })
})
