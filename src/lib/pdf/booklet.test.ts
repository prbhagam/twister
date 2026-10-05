import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  BLANK_PAGE_NOTICE,
  SCANTRON_CLEAR_BAND_IN,
  SCANTRON_NOTICE_BASELINE_IN,
  addScantronBackPage,
  padBooklet,
} from './renderer'
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
  await addScantronBackPage(doc)
  await padBooklet(doc, exam)
  return doc
}

describe('addScantronBackPage', () => {
  it('adds exactly one page', async () => {
    const doc = await body(5)
    await addScantronBackPage(doc)
    expect(doc.getPageCount()).toBe(6)
  })

  it('places its notice in the template\'s ink-free band', async () => {
    // This is the one page in the packet that goes through a scanner. Duplex
    // printing preserves vertical position, so the notice has to sit behind the
    // strip of the front carrying no ink — otherwise show-through on thin stock
    // lands inside an answer bubble, and the sheet grades wrong.
    expect(SCANTRON_NOTICE_BASELINE_IN).toBeGreaterThan(SCANTRON_CLEAR_BAND_IN.top)
    expect(SCANTRON_NOTICE_BASELINE_IN).toBeLessThan(SCANTRON_CLEAR_BAND_IN.bottom)
  })

  it('actually draws the notice, rather than leaving the page bare', async () => {
    const doc = await body(2)
    await addScantronBackPage(doc)

    // A page nothing has been drawn on carries no content stream at all, so this
    // separates "the notice was drawn" from "a blank page was inserted" — which is
    // exactly what this page used to be.
    expect(doc.getPage(1).node.Contents()).toBeDefined()
    expect(doc.getPage(2).node.Contents()).toBeUndefined()
  })

  it('uses the same wording as the parity filler at the back', () => {
    // Two different sentences for two blank pages in one packet would read as two
    // different problems.
    expect(BLANK_PAGE_NOTICE).toBe('This page is intentionally blank.')
  })

  it('inserts at index 1, leaving the bubble sheet as page 1', async () => {
    // Gradescope reads position 1 of the packet; the sheet must stay first.
    const doc = await PDFDocument.create()
    const first = doc.addPage([612, 792])
    first.drawText('SHEET')
    doc.addPage([400, 400]) // a distinguishable body page
    await addScantronBackPage(doc)

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

  it('costs one blank plus one or two fillers, never more', async () => {
    // Bubble sheet + scantron back = 2, so the assembled count has the body's
    // parity. An odd body needs one filler to land even; an even body is already
    // even but ends on content, so it needs two to clear the back cover.
    for (const bodyPages of [20, 21]) {
      const doc = await booklet(bodyPages)
      const overhead = doc.getPageCount() - (bodyPages + 1) // +1 = bubble sheet
      expect(overhead).toBe(bodyPages % 2 === 0 ? 3 : 2) // 1 scantron back + fillers
    }
  })

  it('shows no questions when the packet is flipped over', async () => {
    // What a student sees on the back of the stapled packet is page T of a T-page
    // duplex booklet. It has to be filler, not the last page of questions —
    // otherwise a packet face-down on the desk is readable before the exam starts.
    for (const bodyPages of [1, 2, 3, 19, 20, 21, 22, 23]) {
      const doc = await booklet(bodyPages)
      const last = doc.getPageCount() - 1

      expect(doc.getPageCount() % 2).toBe(0) // T even, so page T is the outward back
      // body() leaves its pages bare; only the blank and the fillers get drawn on.
      expect(doc.getPage(last).node.Contents()).toBeDefined()
      // ...and that filler is genuinely extra, not the final question page reused:
      // the last body page sits at index (1 + 1 + bodyPages - 1) and is still bare.
      expect(doc.getPage(bodyPages + 1).node.Contents()).toBeUndefined()
    }
  })
})
