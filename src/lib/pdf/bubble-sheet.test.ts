import { readFile } from 'node:fs/promises'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { BUBBLE_SHEET_PATH, BubbleSheetStamper, fitText, toWinAnsi } from './bubble-sheet'

describe('toWinAnsi', () => {
  it('keeps plain ASCII untouched', () => {
    expect(toWinAnsi('Nadia Abbott')).toBe('Nadia Abbott')
  })

  it('strips accents rather than throwing on them', () => {
    // pdf-lib's standard fonts throw on non-WinAnsi glyphs; a throw here would
    // abort the entire class's generation run.
    expect(toWinAnsi('José Ñuñez')).toBe('Jose Nunez')
  })

  it('drops characters with no Latin equivalent', () => {
    expect(toWinAnsi('李 Wei')).toBe('Wei')
  })

  it('collapses stray whitespace', () => {
    expect(toWinAnsi('  Jane   Doe ')).toBe('Jane Doe')
  })
})

describe('fitText', () => {
  let font: Awaited<ReturnType<PDFDocument['embedFont']>>

  beforeAll(async () => {
    font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
  })

  it('leaves a short name at full size', () => {
    const result = fitText('Marc Bello', font, 185, 11, 6.5)
    expect(result.size).toBe(11)
    expect(result.text).toBe('Marc Bello')
  })

  it('shrinks a long name to fit the field box', () => {
    const long = 'Bartholomew Maximilian Featherstonehaugh III'
    const result = fitText(long, font, 185, 11, 6.5)
    expect(result.size).toBeLessThan(11)
    expect(font.widthOfTextAtSize(result.text, result.size)).toBeLessThanOrEqual(185)
  })

  it('truncates rather than overflow when even the minimum size is too wide', () => {
    const result = fitText('X'.repeat(300), font, 185, 11, 6.5)
    expect(result.text.endsWith('…')).toBe(true)
    expect(font.widthOfTextAtSize(result.text, result.size)).toBeLessThanOrEqual(185)
  })
})

describe('BubbleSheetStamper', () => {
  it('preserves the template page verbatim: 1 page, Letter, unscaled', async () => {
    // The corner fiducials are what Gradescope's scanner registers against, so any
    // resize or re-render of this page breaks OCR for the entire class.
    const stamper = await BubbleSheetStamper.load()
    const bytes = await stamper.renderSingle({ name: 'Jane Doe', gtId: '903000001' })
    const doc = await PDFDocument.load(bytes)

    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect(width).toBeCloseTo(612, 1)
    expect(height).toBeCloseTo(792, 1)
  })

  it('carries the template artwork through, not a blank page', async () => {
    const templateSize = (await readFile(BUBBLE_SHEET_PATH)).byteLength
    const stamper = await BubbleSheetStamper.load()
    const bytes = await stamper.renderSingle({ name: 'Jane Doe', gtId: '903000001' })
    // The bubble grid is ~227 KB of vector art; a regenerated or blank page would
    // be orders of magnitude smaller.
    expect(bytes.byteLength).toBeGreaterThan(templateSize * 0.5)
  })

  it('prepends the sheet ahead of existing body pages', async () => {
    const stamper = await BubbleSheetStamper.load()
    const doc = await PDFDocument.create()
    doc.addPage()
    doc.addPage()
    await stamper.prependTo(doc, { name: 'Jane Doe', gtId: '903000001' })

    expect(doc.getPageCount()).toBe(3)
    // Page 1 must be the bubble sheet: Gradescope reads position 1 of the packet.
    expect(doc.getPage(0).getSize().width).toBeCloseTo(612, 1)
  })

  it('does not throw on a name with non-Latin characters', async () => {
    const stamper = await BubbleSheetStamper.load()
    await expect(
      stamper.renderSingle({ name: 'Sofía Ştefănescu-Łukasiewicz', gtId: '903000002' }),
    ).resolves.toBeInstanceOf(Uint8Array)
  })

  it('rejects a template that is not a single page', async () => {
    const multi = await PDFDocument.create()
    multi.addPage()
    multi.addPage()
    const { writeFile, mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const dir = await mkdtemp(path.join(tmpdir(), 'twister-'))
    const file = path.join(dir, 'bad.pdf')
    await writeFile(file, await multi.save())

    await expect(BubbleSheetStamper.load(file)).rejects.toThrow(/1-page bubble sheet/)
  })
})
