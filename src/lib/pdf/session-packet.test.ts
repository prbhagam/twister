import { PDFArray, PDFDocument, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  COVER_SHEET_FILE,
  INSTRUCTIONS_FILE,
  TA_INSTRUCTIONS,
  buildCoverSheetPdf,
  proctorInstructions,
  buildInstructionsPdf,
  fitOneLine,
  formatSessionDate,
  rosterSlots,
  formatSessionTime,
  printable,
  wrapLines,
  type PacketStudent,
  type SessionPacket,
} from './session-packet'

function students(count: number): PacketStudent[] {
  return Array.from({ length: count }, (_, i) => ({
    lastName: `Student${String(i).padStart(3, '0')}`,
    firstName: 'Sam',
    identity: `9030${String(10000 + i).slice(-5)}`,
  }))
}

function packet(overrides: Partial<SessionPacket> = {}): SessionPacket {
  return {
    courseName: 'CS 1301',
    examTitle: 'Exam 2',
    sessionLabel: '10/27/2026 1:35 PM (Scheller 101)',
    sessionAt: new Date(2026, 9, 27, 13, 35),
    location: 'Scheller 101',
    students: students(40),
    blanks: [],
    ...overrides,
  }
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount()
}

/**
 * The text drawn onto one page, read back out of its content stream. pdf-lib
 * writes each run as a hex string before `Tj`; letter-spaced labels arrive one
 * character per run, so the runs are concatenated in the order they were drawn.
 */
async function pageText(bytes: Uint8Array, index: number): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  const contents = doc.getPage(index).node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents]

  let raw = ''
  for (const stream of streams) {
    if (stream instanceof PDFRawStream) raw += Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
  }
  return [...raw.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join('')
}

describe('packet file names', () => {
  it('sort ahead of every student PDF, cover first', () => {
    // The whole point of the two names: a TA opening the session folder sees the
    // cover sheet, then the instructions, then the papers.
    const listing = [
      'Zhang-Mei-903010999.pdf',
      INSTRUCTIONS_FILE,
      'Abbott-Nadia-903010000.pdf',
      COVER_SHEET_FILE,
    ].sort()
    expect(listing.slice(0, 2)).toEqual([COVER_SHEET_FILE, INSTRUCTIONS_FILE])
  })
})

describe('printable', () => {
  it('folds smart punctuation instead of dropping it', () => {
    // toWinAnsi alone deletes these outright, welding the surrounding words
    // together — silently, and only on paper.
    expect(printable('asking — if unclear')).toBe('asking - if unclear')
    expect(printable('the student’s name')).toBe("the student's name")
    expect(printable('“Signed out”')).toBe('"Signed out"')
    expect(printable('and so on…')).toBe('and so on...')
  })

  it('still drops what no standard font can set', () => {
    expect(printable('Nadia 中文 Abbott')).toBe('Nadia Abbott')
  })
})

describe('TA_INSTRUCTIONS', () => {
  // These are expected to be edited by hand as course policy settles, and a
  // pasted character that pdf-lib cannot set disappears without an error.
  const REACHES_PAPER = /^[\x20-\x7E–—‘’“”…]*$/

  it('uses only characters that survive to the printed page', () => {
    for (const section of [...TA_INSTRUCTIONS, ...proctorInstructions(true)]) {
      expect(section.heading, section.heading).toMatch(REACHES_PAPER)
      for (const item of section.items) expect(item, item).toMatch(REACHES_PAPER)
    }
  })

  it('hands an unexpected arrival a blank exam only when the packet has one', () => {
    const withBlanks = proctorInstructions(true).flatMap((s) => s.items).join(' ')
    expect(withBlanks).toMatch(/give them a blank exam/i)
    expect(withBlanks).toMatch(/end of the roster/i)
    expect(TA_INSTRUCTIONS.flatMap((s) => s.items).join(' ')).not.toMatch(/blank exam/i)
  })

  it('points an unexpected arrival at the write-in block that actually exists', () => {
    // The block lives at the end of the roster; an instruction pointing anywhere
    // else (the cover sheet, say, which the TA left behind) sends them nowhere.
    const all = TA_INSTRUCTIONS.flatMap((s) => s.items).join(' ')
    expect(all).toMatch(/not on the roster/i)
    expect(all).toMatch(/end of the roster/i)
  })

  it('tells the TA the cover sheet stays behind, and gets signed at both ends', () => {
    const all = TA_INSTRUCTIONS.flatMap((s) => s.items).join(' ')
    expect(all).toMatch(/cover sheet stays with the exam file/i)
    expect(all).toMatch(/"Signed out"/)
    expect(all).toMatch(/"Signed in"/)
  })
})

describe('wrapLines', () => {
  it('keeps every word, in order', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const text = 'Count the papers and check the count against the cover sheet before you leave with them.'
    const lines = wrapLines(text, font, 9.5, 160)

    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(' ')).toBe(text)
    for (const line of lines) expect(font.widthOfTextAtSize(line, 9.5)).toBeLessThanOrEqual(160)
  })

  it('does not loop forever on a word wider than the column', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    expect(wrapLines('Fitzgerald-Whitmore-Vandenberg', font, 9, 20)).toEqual(['Fitzgerald-Whitmore-Vandenberg'])
  })
})

describe('fitOneLine', () => {
  it('shrinks a long title until it fits, and leaves a short one alone', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.HelveticaBold)

    expect(fitOneLine('Exam 2', font, 504, 34, 20)).toBe(34)

    const long = 'Exam 2 - Loops, Lists and Dictionaries'
    const size = fitOneLine(long, font, 504, 34, 20)
    expect(size).toBeLessThan(34)
    expect(font.widthOfTextAtSize(long, size)).toBeLessThanOrEqual(504)
  })

  it('never goes below the floor, even for text that cannot fit', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.HelveticaBold)
    expect(fitOneLine('x'.repeat(400), font, 504, 34, 20)).toBe(20)
  })
})

describe('session formatting', () => {
  it('spells the date and time out for the cover sheet', () => {
    expect(formatSessionDate(new Date(2026, 9, 27, 13, 35))).toBe('Tuesday, October 27, 2026')
    expect(formatSessionTime(new Date(2026, 9, 27, 13, 35))).toBe('1:35 PM')
  })

  it('is empty for a bucket with no parsed session, so the cover prints a rule to write on', () => {
    expect(formatSessionDate(null)).toBe('')
    expect(formatSessionTime(null)).toBe('')
  })
})

describe('buildCoverSheetPdf', () => {
  it('is exactly one page — it is what sits on top of the stack', async () => {
    expect(await pageCount(await buildCoverSheetPdf(packet()))).toBe(1)
  })

  it('stays one page for an exception bucket, which has no date, time, or location', async () => {
    const bytes = await buildCoverSheetPdf(
      packet({ sessionLabel: 'GTE', sessionAt: null, location: null, students: students(3) }),
    )
    expect(await pageCount(bytes)).toBe(1)
  })

  it('stays one page when the exam title is long enough to wrap', async () => {
    const title = 'Exam 2 - Loops, Lists, Dictionaries, and Everything Else We Have Covered So Far This Term'
    expect(await pageCount(await buildCoverSheetPdf(packet({ examTitle: title })))).toBe(1)
  })
})

describe('rosterSlots', () => {
  it('ends the list with the write-in block rather than reserving space for it', () => {
    // Reserved space cost every roster page six rows a column, whether or not the
    // block ever landed there.
    expect(rosterSlots(students(3)).map((s) => s.kind)).toEqual([
      'student',
      'student',
      'student',
      'gap',
      'write-in-heading',
      'write-in',
      'write-in',
    ])
  })
})

describe('rosterSlots with blank exams', () => {
  it('gives each blank its own labelled write-in row, in place of the anonymous ones', () => {
    const slots = rosterSlots(students(2), ['BLANK-01', 'BLANK-02', 'BLANK-03'])
    expect(slots.map((s) => s.kind)).toEqual([
      'student',
      'student',
      'gap',
      'write-in-heading',
      'write-in',
      'write-in',
      'write-in',
    ])
    expect(slots.flatMap((s) => (s.kind === 'write-in' && s.blank ? [s.blank] : []))).toEqual([
      'BLANK-01',
      'BLANK-02',
      'BLANK-03',
    ])
  })
})

describe('a session packet carrying blank exams', () => {
  const blanks = ['BLANK-04', 'BLANK-05', 'BLANK-06']

  it('counts the blanks among the papers the TA signs for', async () => {
    const text = await pageText(await buildCoverSheetPdf(packet({ students: students(37), blanks })), 0)
    expect(text).toContain('40')
    expect(text).toContain('Includes 3 blank exams.')
  })

  it('prints each blank number on the roster for the TA to write a name against', async () => {
    const text = await pageText(await buildInstructionsPdf(packet({ students: students(12), blanks })), 0)
    for (const blank of blanks) expect(text).toContain(blank)
  })

  it('still fits roster and script on one sheet for a normal session', async () => {
    for (const count of [1, 40, 69]) {
      const pages = await pageCount(await buildInstructionsPdf(packet({ students: students(count), blanks })))
      expect(pages, `${count} students`).toBe(2)
    }
  })
})

describe('buildInstructionsPdf', () => {
  it('is one side of roster and one side of instructions for a normal session', async () => {
    // What the request asked for: a front/back sheet. If an edit to
    // TA_INSTRUCTIONS pushes the script onto a second page, this is the warning.
    expect(await pageCount(await buildInstructionsPdf(packet({ students: students(1) })))).toBe(2)
    expect(await pageCount(await buildInstructionsPdf(packet({ students: students(40) })))).toBe(2)
    expect(await pageCount(await buildInstructionsPdf(packet({ students: students(69) })))).toBe(2)
  })

  it('leads with the roster, because that is what a TA works from at the door', async () => {
    const bytes = await buildInstructionsPdf(packet({ students: students(12) }))
    expect(await pageText(bytes, 0)).toContain('Session roster')
    expect(await pageText(bytes, 1)).toContain('Proctor instructions')
  })

  it('carries no run identifiers — the sheet is about the session, not the print job', async () => {
    const bytes = await buildInstructionsPdf(packet({ students: students(12) }))
    const text = (await pageText(bytes, 0)) + (await pageText(bytes, 1))
    expect(text).not.toMatch(/generated/i)
    expect(text).not.toMatch(/\brun\b/i)
  })

  it('always ends on an even page, so duplex printing never backs it with the next document', async () => {
    for (const count of [0, 1, 40, 83, 200, 400]) {
      const pages = await pageCount(await buildInstructionsPdf(packet({ students: students(count) })))
      expect(pages % 2, `${count} students`).toBe(0)
    }
  })

  it('adds roster pages for a session too big for one, rather than dropping students', async () => {
    const small = await pageCount(await buildInstructionsPdf(packet({ students: students(40) })))
    const large = await pageCount(await buildInstructionsPdf(packet({ students: students(400) })))
    expect(large).toBeGreaterThan(small)
  })

  it('renders a session with no papers at all', async () => {
    expect(await pageCount(await buildInstructionsPdf(packet({ students: [] })))).toBe(2)
  })

  it('renders a student with no GT ID, rather than throwing on the null', async () => {
    const bytes = await buildInstructionsPdf(
      packet({ students: [{ lastName: 'Abbott', firstName: 'Nadia', identity: null }] }),
    )
    expect(await pageCount(bytes)).toBe(2)
  })
})

describe('the cover sheet as a custody record', () => {
  it('says it stays behind, and carries no run identifiers', async () => {
    const text = await pageText(await buildCoverSheetPdf(packet()), 0)
    expect(text).toContain('CHAIN OF CUSTODY')
    expect(text).toContain('stays with the exam file')
    expect(text).not.toMatch(/generated/i)
  })

  it('states the session and the number of papers it accounts for', async () => {
    const text = await pageText(await buildCoverSheetPdf(packet({ students: students(37) })), 0)
    expect(text).toContain('Tuesday, October 27, 2026')
    expect(text).toContain('1:35 PM')
    expect(text).toContain('Scheller 101')
    expect(text).toContain('37')
  })
})
