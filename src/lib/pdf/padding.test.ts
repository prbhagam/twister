import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { padBooklet } from './renderer'
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

async function bookletOf(pages: number) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  return doc
}

describe('padBooklet', () => {
  it('pads an odd booklet to even', async () => {
    // The whole point: printed double-sided, an odd booklet puts the *next*
    // student's bubble sheet on the back of this student's last page.
    const doc = await bookletOf(21)
    await padBooklet(doc, exam)
    expect(doc.getPageCount()).toBe(22)
  })

  it('gives an even booklet a whole sheet of filler', async () => {
    // An even booklet already ends even, but it ends on *content* — and duplex puts
    // an even page on the back of its sheet, so that content is the back cover.
    // Clearing the back costs a full sheet: one filler would only make it odd.
    const doc = await bookletOf(22)
    await padBooklet(doc, exam)
    expect(doc.getPageCount()).toBe(24)
  })

  it('never adds more than one sheet, and always lands even', async () => {
    for (const n of [1, 2, 3, 20, 21, 22, 23]) {
      const doc = await bookletOf(n)
      await padBooklet(doc, exam)
      expect(doc.getPageCount() - n).toBeLessThanOrEqual(2)
      expect(doc.getPageCount() % 2).toBe(0)
    }
  })

  it('always ends on a filler, so the back cover is never a question page', async () => {
    // The guarantee, stated directly: page T of an even T-page duplex booklet is
    // the outward-facing back. bookletOf() leaves its pages bare, so a drawn
    // content stream is what separates a filler from a body page.
    for (const n of [1, 2, 3, 20, 21, 22, 23]) {
      const doc = await bookletOf(n)
      await padBooklet(doc, exam)

      expect(doc.getPageCount() % 2).toBe(0)
      expect(doc.getPage(doc.getPageCount() - 1).node.Contents()).toBeDefined()
      // The page that *was* last is untouched body, confirming nothing was drawn
      // over the questions to achieve this.
      expect(doc.getPage(n - 1).node.Contents()).toBeUndefined()
    }
  })

  it('fills both sides of the extra sheet when it adds one', async () => {
    // The added sheet is blank front and back. Leaving its front bare would read as
    // a misprint to a student thumbing back through the packet.
    const doc = await bookletOf(22)
    await padBooklet(doc, exam)
    expect(doc.getPage(22).node.Contents()).toBeDefined()
    expect(doc.getPage(23).node.Contents()).toBeDefined()
  })

  it('adds the filler at the end, not before the questions', async () => {
    const doc = await bookletOf(3)
    const before = doc.getPageCount()
    await padBooklet(doc, exam)
    // The bubble sheet must stay page 1 — Gradescope reads position 1 of the packet.
    expect(doc.getPageCount()).toBe(before + 1)
    expect(doc.getPage(0).getSize().width).toBeCloseTo(612, 1)
  })

  it('gives the filler the same page size as the rest', async () => {
    const doc = await bookletOf(1)
    await padBooklet(doc, exam)
    const filler = doc.getPage(1).getSize()
    expect(filler.width).toBeCloseTo(612, 1)
    expect(filler.height).toBeCloseTo(792, 1)
  })

  it('does not throw on a name with characters outside WinAnsi', async () => {
    // pdf-lib's standard fonts throw on unmapped glyphs, which would abort the run.
    const doc = await bookletOf(1)
    await expect(
      padBooklet(doc, { ...exam, studentName: 'Sofía Ştefănescu-Łukasiewicz' }),
    ).resolves.toBeUndefined()
  })

  it('keeps every booklet even so a merged stack stays aligned', async () => {
    // Simulates the real failure: booklets of 20/21/22/23 concatenated. Every
    // booklet must begin on an odd page of the merged file, i.e. a fresh sheet.
    let cumulative = 0
    for (const n of [20, 21, 22, 23, 21, 21]) {
      expect(cumulative % 2).toBe(0) // this booklet starts on a fresh sheet
      const doc = await bookletOf(n)
      await padBooklet(doc, exam)
      cumulative += doc.getPageCount()
    }
    expect(cumulative % 2).toBe(0)
  })
})
