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

  it('leaves an even booklet alone', async () => {
    const doc = await bookletOf(22)
    await padBooklet(doc, exam)
    expect(doc.getPageCount()).toBe(22)
  })

  it('never adds more than one page', async () => {
    for (const n of [1, 2, 3, 20, 21, 22, 23]) {
      const doc = await bookletOf(n)
      await padBooklet(doc, exam)
      expect(doc.getPageCount() - n).toBeLessThanOrEqual(1)
      expect(doc.getPageCount() % 2).toBe(0)
    }
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
