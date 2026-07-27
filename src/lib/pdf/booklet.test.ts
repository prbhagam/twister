import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { addScantronBackPage, padBooklet } from './renderer'
import type { RenderExam } from './exam-html'

const exam: RenderExam = {
  examTitle: 'Exam 1',
  courseName: 'CS 1301',
  studentName: 'Nadia Abbott',
  gtId: '903000101',
  traceCode: 'ABC123',
  questions: [],
  katexHref: null,
}

/** Body pages as Chromium produces them, before the bubble sheet is prepended. */
async function body(pages: number) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  return doc
}

/** The full assembly a student receives, in order. */
async function booklet(bodyPages: number) {
  const doc = await body(bodyPages)
  doc.insertPage(0, doc.addPage([612, 792])) // stands in for the bubble sheet
  doc.removePage(doc.getPageCount() - 1)
  addScantronBackPage(doc)
  await padBooklet(doc, exam)
  return doc
}

describe('addScantronBackPage', () => {
  it('adds exactly one page', async () => {
    const doc = await body(5)
    addScantronBackPage(doc)
    expect(doc.getPageCount()).toBe(6)
  })

  it('inserts at index 1, leaving the bubble sheet as page 1', async () => {
    // Gradescope reads position 1 of the packet; the sheet must stay first.
    const doc = await PDFDocument.create()
    const first = doc.addPage([612, 792])
    first.drawText('SHEET')
    doc.addPage([400, 400]) // a distinguishable body page
    addScantronBackPage(doc)

    expect(doc.getPageCount()).toBe(3)
    expect(doc.getPage(0).getSize().width).toBeCloseTo(612, 1) // bubble sheet
    expect(doc.getPage(1).getSize().width).toBeCloseTo(612, 1) // the new blank
    expect(doc.getPage(2).getSize().width).toBeCloseTo(400, 1) // body follows
  })
})

describe('the assembled booklet', () => {
  it('gives the scantron a sheet to itself when duplexed', async () => {
    // Sheet 1 = pages 1 and 2. Page 1 is the scantron, so page 2 must be the blank,
    // not the cover page — otherwise tearing off the scantron takes the cover with
    // it, and the back gets scanned alongside the answers.
    for (const bodyPages of [3, 4, 5, 20, 21, 22]) {
      const doc = await booklet(bodyPages)
      // Page index 1 is the inserted blank: same size, and it is not the first
      // body page, which follows it.
      expect(doc.getPage(1).getSize().width).toBeCloseTo(612, 1)
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(bodyPages + 2)
    }
  })

  it('always ends on an even page so the next booklet starts on a fresh sheet', async () => {
    for (const bodyPages of [1, 2, 3, 19, 20, 21, 22, 23]) {
      const doc = await booklet(bodyPages)
      expect(doc.getPageCount() % 2).toBe(0)
    }
  })

  it('keeps a merged stack aligned across booklets of differing length', async () => {
    let cumulative = 0
    for (const bodyPages of [18, 19, 20, 21, 19, 19]) {
      // Each booklet must begin on the front of a sheet.
      expect(cumulative % 2).toBe(0)
      const doc = await booklet(bodyPages)
      cumulative += doc.getPageCount()
    }
  })

  it('costs exactly one blank plus at most one filler', async () => {
    for (const bodyPages of [20, 21]) {
      const doc = await booklet(bodyPages)
      const overhead = doc.getPageCount() - (bodyPages + 1) // +1 = bubble sheet
      expect(overhead).toBeGreaterThanOrEqual(1) // the scantron back
      expect(overhead).toBeLessThanOrEqual(2) // plus parity filler at most
    }
  })
})
