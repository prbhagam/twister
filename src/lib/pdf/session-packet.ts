import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { SHEET_SIZE, toWinAnsi } from './bubble-sheet'
import { BLANK_PAGE_NOTICE } from './renderer'

/**
 * The two sheets generated for each session folder in the by-session ZIP.
 *
 * They are used in different places, which is what drives their design:
 *
 *  - The **cover sheet** stays with the exam file. It is the custody record —
 *    a TA signs it when they take the papers and again when they bring the
 *    completed papers back — so it never needs to be readable in a noisy room,
 *    only unambiguous about which session's papers these are and who has them.
 *  - The **instruction sheet** travels with the papers. Roster on the front,
 *    proctor script on the back, because the roster is what a TA opens first
 *    and works from while students file in.
 *
 * Drawn with pdf-lib rather than the HTML pipeline the booklet uses. These are
 * built on the fly while a ZIP is being streamed, once per session folder, and
 * launching Chromium for a page of fixed-position form rules would dominate a
 * download that otherwise only copies files off disk.
 *
 * Everything here obeys the same black-and-white constraint as the booklet (see
 * print-theme.ts): same laser printer, and nothing on either page leans on a
 * hue to carry meaning.
 */

const [PAGE_W, PAGE_H] = SHEET_SIZE
const MARGIN = 54
const CONTENT_W = PAGE_W - MARGIN * 2

const INK = rgb(0, 0, 0)
const MUTED = rgb(0.29, 0.29, 0.29)
const RULE = rgb(0.72, 0.72, 0.72)
const RULE_STRONG = rgb(0.45, 0.45, 0.45)

/** Filenames chosen so a plain alphabetical listing puts them first and second,
 * ahead of every `Lastname-Firstname-…pdf` in the folder. */
export const COVER_SHEET_FILE = '00-COVER-SHEET.pdf'
export const INSTRUCTIONS_FILE = '01-INSTRUCTIONS.pdf'

export interface PacketStudent {
  firstName: string
  lastName: string
  /** GT ID, falling back to username the way the signups dashboard does. */
  identity: string | null
}

export interface SessionPacket {
  courseName: string
  examTitle: string
  /** The bucket's own label — a session string as the sign-up sheet wrote it, or
   * an instructor's short name for an exception group. */
  sessionLabel: string
  /** Parsed session start; null for exception buckets, which print blank rules
   * for a TA to fill in by hand instead. */
  sessionAt: Date | null
  location: string | null
  /** Exactly the students whose papers are in this folder, so the roster length
   * and the cover sheet's paper count can never disagree with the stack. */
  students: PacketStudent[]
}

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

type Color = ReturnType<typeof rgb>

// ------------------------------------------------------------------ text

/**
 * pdf-lib's standard fonts stop at WinAnsi, and toWinAnsi drops whatever falls
 * outside it rather than failing — an em dash or a curly quote pasted into the
 * instructions below would silently vanish mid-sentence, welding two words
 * together. Smart punctuation is folded to its ASCII equivalent first, so text
 * edited into this file later still reaches paper intact.
 */
export function printable(text: string): string {
  return toWinAnsi(
    text
      .replace(/[–—]/g, '-')
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/…/g, '...'),
  )
}

/** Greedy word wrap, measured in the font the caller will actually draw with. */
export function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = printable(text).split(' ').filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  lines.push(line)
  return lines
}

/** Largest size at or below `max` that keeps the text on one line. */
export function fitOneLine(text: string, font: PDFFont, maxWidth: number, max: number, min: number): number {
  let size = max
  while (size > min && font.widthOfTextAtSize(printable(text), size) > maxWidth) size -= 0.5
  return size
}

/** "Tuesday, October 27, 2026" — empty when the bucket carries no parsed date. */
export function formatSessionDate(at: Date | null): string {
  if (!at) return ''
  return at.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

/** "1:35 PM" — empty when the bucket carries no parsed time. */
export function formatSessionTime(at: Date | null): string {
  if (!at) return ''
  return at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// ------------------------------------------------------------------ primitives

interface TextOpts {
  x: number
  y: number
  size: number
  font: PDFFont
  color?: Color
}

function drawText(page: PDFPage, text: string, opts: TextOpts) {
  page.drawText(printable(text), { x: opts.x, y: opts.y, size: opts.size, font: opts.font, color: opts.color ?? INK })
}

function drawRightText(page: PDFPage, text: string, opts: Omit<TextOpts, 'x'> & { right: number }) {
  const clean = printable(text)
  drawText(page, clean, { ...opts, x: opts.right - opts.font.widthOfTextAtSize(clean, opts.size) })
}

/** Letter-spaced small caps, the one typographic flourish on either sheet: it is
 * what lets a label sit quietly under a value instead of competing with it. */
const TRACKING = 1.1

function trackedWidth(text: string, font: PDFFont, size: number): number {
  const clean = printable(text)
  return font.widthOfTextAtSize(clean, size) + Math.max(0, clean.length - 1) * TRACKING
}

function drawTracked(page: PDFPage, text: string, opts: TextOpts) {
  let x = opts.x
  for (const ch of printable(text)) {
    page.drawText(ch, { x, y: opts.y, size: opts.size, font: opts.font, color: opts.color ?? INK })
    x += opts.font.widthOfTextAtSize(ch, opts.size) + TRACKING
  }
}

/** A section label: uppercase, tracked, muted, small. */
function drawLabel(page: PDFPage, fonts: Fonts, text: string, opts: { x: number; y: number; size?: number; color?: Color }) {
  drawTracked(page, text.toUpperCase(), {
    x: opts.x,
    y: opts.y,
    size: opts.size ?? 7.5,
    font: fonts.bold,
    color: opts.color ?? MUTED,
  })
}

function drawRule(page: PDFPage, y: number, x = MARGIN, width = CONTENT_W, thickness = 0.6, color = RULE) {
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness, color })
}

/**
 * One fill-in field: a rule to write on with its label set beneath it, so the
 * writing space above stays completely clear.
 */
function drawField(page: PDFPage, fonts: Fonts, opts: { x: number; y: number; width: number; label: string }) {
  drawRule(page, opts.y, opts.x, opts.width, 0.75, RULE_STRONG)
  if (opts.label) drawLabel(page, fonts, opts.label, { x: opts.x, y: opts.y - 11 })
}

// ------------------------------------------------------------------ cover sheet

/** Vertical space a signature panel needs for its title, caption, and n field rows. */
const PANEL_PAD_TOP = 38
const PANEL_ROW = 36
const PANEL_PAD_BOTTOM = 18

function panelHeight(rows: number): number {
  return PANEL_PAD_TOP + rows * PANEL_ROW + PANEL_PAD_BOTTOM
}

/**
 * A numbered signature panel. Bordered in grey rather than black: the border is
 * only there to say "these fields belong together", and a heavy rule around
 * two signature lines reads as a form to be endured.
 */
function drawPanel(
  page: PDFPage,
  fonts: Fonts,
  opts: { top: number; rows: number; step: string; title: string; caption: string },
): number {
  const height = panelHeight(opts.rows)
  const bottom = opts.top - height
  page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: CONTENT_W,
    height,
    borderWidth: 0.75,
    borderColor: RULE,
  })

  const x = MARGIN + 20
  drawText(page, opts.step, { x, y: opts.top - 21, size: 13, font: fonts.bold })
  drawLabel(page, fonts, opts.title, { x: x + 16, y: opts.top - 20, size: 10, color: INK })
  drawText(page, opts.caption, { x, y: opts.top - 35, size: 8.5, font: fonts.regular, color: MUTED })
  return bottom
}

/**
 * The page that stays with the exam file: which session these papers belong to,
 * how many there are, and the two signatures that account for them leaving and
 * coming back.
 */
export async function buildCoverSheetPdf(packet: SessionPacket): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }
  const page = doc.addPage(SHEET_SIZE)

  /**
   * The custody half is anchored to the bottom edge and the identity half flows
   * down from the top, with the slack between them absorbed by the spacing of
   * the date/time/location rows. An exam title long enough to wrap therefore
   * tightens those three rows instead of pushing a signature line off the page.
   */
  const outPanel = { rows: 2 } // TA name + papers taken, then signature + date
  const inPanel = { rows: 3 } // ...plus a notes line, written at handover
  const inTop = MARGIN + panelHeight(inPanel.rows)
  const outTop = inTop + 18 + panelHeight(outPanel.rows)
  const custodyLabelY = outTop + 18
  const custodyTitleY = custodyLabelY + 15
  const custodyRuleY = custodyTitleY + 24

  const countY = custodyRuleY + 20
  const countLabelY = countY + 36
  const innerRuleY = countLabelY + 24
  const sheetLabelY = innerRuleY + 22

  // --- identity
  let y = PAGE_H - MARGIN
  drawLabel(page, fonts, packet.courseName, { x: MARGIN, y, size: 8.5 })
  const flag = 'Cover sheet'
  drawTracked(page, flag.toUpperCase(), {
    x: PAGE_W - MARGIN - trackedWidth(flag.toUpperCase(), fonts.bold, 8.5),
    y,
    size: 8.5,
    font: fonts.bold,
    color: MUTED,
  })
  y -= 14
  drawRule(page, y, MARGIN, CONTENT_W, 1, INK)

  y -= 42
  const titleSize = fitOneLine(packet.examTitle, fonts.bold, CONTENT_W, 32, 20)
  for (const line of wrapLines(packet.examTitle, fonts.bold, titleSize, CONTENT_W)) {
    drawText(page, line, { x: MARGIN, y, size: titleSize, font: fonts.bold })
    y -= titleSize + 5
  }

  const rowStep = Math.max(28, Math.min(46, (y - 16 - (sheetLabelY + 10)) / 3))

  y -= 16
  const valueX = MARGIN + 104
  const valueW = PAGE_W - MARGIN - valueX
  const rows: [string, string][] = [
    ['Date', formatSessionDate(packet.sessionAt)],
    ['Time', formatSessionTime(packet.sessionAt)],
    ['Location', packet.location ?? ''],
  ]
  for (const [label, value] of rows) {
    drawLabel(page, fonts, label, { x: MARGIN, y: y + 5, size: 8 })
    if (value) {
      drawText(page, value, { x: valueX, y, size: fitOneLine(value, fonts.bold, valueW, 21, 13), font: fonts.bold })
    } else {
      // An exception bucket has no parsed session: a rule to fill in by hand.
      drawRule(page, y - 2, valueX, valueW, 0.75, RULE_STRONG)
    }
    y -= rowStep
  }

  // The sign-up sheet's own wording, kept verbatim under the parsed fields: it
  // is what the student saw when they signed up, so it is what a question about
  // "which session is this" gets settled against.
  drawText(page, `Sign-up sheet label: ${packet.sessionLabel}`, {
    x: MARGIN,
    y: sheetLabelY,
    size: 8.5,
    font: fonts.regular,
    color: MUTED,
  })

  drawRule(page, innerRuleY)

  drawLabel(page, fonts, 'Papers in this packet', { x: MARGIN, y: countLabelY })
  const count = String(packet.students.length)
  drawText(page, count, { x: MARGIN, y: countY, size: 34, font: fonts.bold })
  drawText(page, 'Count them before you leave, and again when they come back.', {
    x: MARGIN + 14 + fonts.bold.widthOfTextAtSize(count, 34),
    y: countY + 3,
    size: 9,
    font: fonts.regular,
    color: MUTED,
  })

  // --- custody
  drawRule(page, custodyRuleY)
  drawLabel(page, fonts, 'Chain of custody', { x: MARGIN, y: custodyTitleY, size: 10, color: INK })
  drawText(page, 'This sheet stays with the exam file. The TA takes the papers and the instruction sheet, not this page.', {
    x: MARGIN,
    y: custodyLabelY,
    size: 8.5,
    font: fonts.regular,
    color: MUTED,
  })

  const inner = CONTENT_W - 40
  const gap = 18
  const nameW = inner * 0.56
  const restW = inner - nameW - gap

  drawPanel(page, fonts, {
    top: outTop,
    rows: outPanel.rows,
    step: '1',
    title: 'Signed out',
    caption: 'TA taking these papers to the exam session.',
  })
  let fy = outTop - PANEL_PAD_TOP - 14
  drawField(page, fonts, { x: MARGIN + 20, y: fy, width: nameW, label: 'TA name (print)' })
  drawField(page, fonts, { x: MARGIN + 20 + nameW + gap, y: fy, width: restW, label: 'Papers taken' })
  fy -= PANEL_ROW
  drawField(page, fonts, { x: MARGIN + 20, y: fy, width: nameW, label: 'Signature' })
  drawField(page, fonts, { x: MARGIN + 20 + nameW + gap, y: fy, width: restW, label: 'Date and time' })

  drawPanel(page, fonts, {
    top: inTop,
    rows: inPanel.rows,
    step: '2',
    title: 'Signed in',
    caption: 'TA returning the completed papers, plus every unused paper.',
  })
  fy = inTop - PANEL_PAD_TOP - 14
  drawField(page, fonts, { x: MARGIN + 20, y: fy, width: nameW, label: 'TA name (print)' })
  drawField(page, fonts, { x: MARGIN + 20 + nameW + gap, y: fy, width: restW, label: 'Papers returned' })
  fy -= PANEL_ROW
  drawField(page, fonts, { x: MARGIN + 20, y: fy, width: nameW, label: 'Signature' })
  drawField(page, fonts, { x: MARGIN + 20 + nameW + gap, y: fy, width: restW, label: 'Date and time' })
  fy -= PANEL_ROW
  drawField(page, fonts, { x: MARGIN + 20, y: fy, width: inner, label: 'Anything that went wrong' })

  return doc.save()
}

// ---------------------------------------------------------------- instructions

export interface InstructionSection {
  heading: string
  items: string[]
}

/**
 * The default proctor script. Deliberately a plain data structure and nothing
 * more: this is course policy, not program logic, and it is expected to be
 * edited here directly as a course's own rules settle.
 */
export const TA_INSTRUCTIONS: InstructionSection[] = [
  {
    heading: 'Before the session',
    items: [
      'Sign and date the "Signed out" box on the cover sheet when you collect the papers. The cover sheet stays with the exam file — you take the papers and this sheet.',
      'Count the papers against the number on the cover sheet before you leave with them.',
      'Arrive at least 15 minutes early, and keep the papers with you the whole way. Never leave them in an office, a car, or an unlocked room.',
      'Set the room up so students are spaced as far apart as the seating allows.',
    ],
  },
  {
    heading: 'Checking students in',
    items: [
      "Every paper is unique to the student whose name is printed on it. Hand each student only their own paper - never a spare, never a neighbour's.",
      "Check each student's BuzzCard against the roster and tick their box as they are seated.",
      'A student who is not on the roster may have signed up for a different session. Do not turn them away: seat them, write them in at the end of the roster, and tell the instructor.',
      'Leftover papers stay in the packet. They go back to the instructor unused.',
    ],
  },
  {
    heading: 'Starting the exam',
    items: [
      'Write the start time and the end time on the board, and announce both.',
      "The bubble sheet is the first page and is already printed with the student's name and GT ID. Have each student confirm the printed name is theirs, then tear the bubble sheet off the packet.",
      'Remind students that answers only count if they are marked on the bubble sheet, in pencil, filled in completely.',
      'Permitted: pencils, erasers, and anything the instructor announced for this exam. Not permitted: phones, smart watches, earbuds, or notes.',
    ],
  },
  {
    heading: 'During the exam',
    items: [
      'Circulate. Do not sit at the front for the whole session.',
      'Answer questions about wording and logistics only. Do not explain or re-interpret what a question is asking.',
      'One student out of the room at a time. Phones stay at the desk.',
      'If you suspect academic misconduct, do not confront the student. Note the time, the seat, and what you saw, let them finish, and report it the same day.',
      'Log anything else out of the ordinary - a late arrival, an illness, a fire alarm - with the time it happened.',
    ],
  },
  {
    heading: 'Ending the session',
    items: [
      'Announce 15 minutes and 5 minutes remaining.',
      'At the end time, all writing stops. Collect both the bubble sheet and the question booklet from every student.',
      'Nobody leaves until you have their papers.',
      'Count the collected papers against your ticks before the room empties. If the counts disagree, resolve it while the students are still there.',
    ],
  },
  {
    heading: 'After the session',
    items: [
      'Return every paper - completed, unused, and spoiled - to the exam file as one packet.',
      'Sign and date the "Signed in" box on the cover sheet, and write down anything that went wrong.',
      'Never photograph, scan, email, or copy an exam paper, and do not discuss it with anyone who has not sat it yet.',
    ],
  },
]

/** Where a flowing page is allowed to put its last baseline — clear of the page
 * number, which sits at MARGIN - 16. */
const FLOW_BOTTOM = MARGIN + 12

interface Column {
  x: number
  width: number
}

/** A page being filled top-down, one column at a time. */
interface Flow {
  page: PDFPage
  columns: Column[]
  index: number
  y: number
  top: number
  bottom: number
}

function column(flow: Flow): Column {
  return flow.columns[flow.index]
}

/** Moves to the next column, or a fresh page once they are used up. */
function advance(flow: Flow, nextPage: () => Flow): void {
  if (flow.index < flow.columns.length - 1) {
    flow.index++
    flow.y = flow.top
    return
  }
  Object.assign(flow, nextPage())
}

function fits(flow: Flow, height: number): boolean {
  return flow.y - height >= flow.bottom
}

/**
 * The sheet that travels with the papers: roster on the front, proctor script on
 * the back. Roster first because it is what a TA works from while students file
 * in; the script is read once, beforehand.
 *
 * Padded to an even page count for the same reason the booklet is — printed
 * duplex, an odd last page comes back with the next document on its reverse.
 */
export async function buildInstructionsPdf(
  packet: SessionPacket,
  sections: InstructionSection[] = TA_INSTRUCTIONS,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }

  /** Running head, title, and standfirst. Returns the first free baseline. */
  const startPage = (title: string, standfirst: string): number => {
    const page = doc.addPage(SHEET_SIZE)
    let y = PAGE_H - MARGIN
    drawLabel(page, fonts, packet.courseName, { x: MARGIN, y, size: 8 })
    drawRightText(page, sessionHeaderLine(packet), { right: PAGE_W - MARGIN, y, size: 8.5, font: fonts.regular, color: MUTED })
    y -= 14
    drawRule(page, y, MARGIN, CONTENT_W, 1, INK)

    y -= 38
    drawText(page, title, { x: MARGIN, y, size: fitOneLine(title, fonts.bold, CONTENT_W, 22, 15), font: fonts.bold })
    y -= 18
    drawText(page, standfirst, { x: MARGIN, y, size: 9, font: fonts.regular, color: MUTED })
    return y - 32
  }

  const COL_GAP = 30
  const COL_W = (CONTENT_W - COL_GAP) / 2
  const columns: Column[] = [
    { x: MARGIN, width: COL_W },
    { x: MARGIN + COL_W + COL_GAP, width: COL_W },
  ]

  drawRoster(doc, fonts, packet, columns, startPage)
  drawScript(doc, fonts, packet, sections, columns, startPage)

  padToEvenPages(doc, fonts)
  stampPageNumbers(doc, fonts)
  return doc.save()
}

const ROSTER_ROW_H = 15.5

/** One slot in the roster grid: a student, the write-in heading, or a blank
 * write-in rule. The write-in rows are part of the same flowing list rather than
 * a block reserved at the foot of the page — reserving it cost every roster page
 * six rows a column, which is most of a page across a large session. */
type RosterSlot =
  | { kind: 'student'; student: PacketStudent }
  | { kind: 'gap' }
  | { kind: 'write-in-heading' }
  | { kind: 'write-in' }

export function rosterSlots(students: PacketStudent[]): RosterSlot[] {
  return [
    ...students.map((student): RosterSlot => ({ kind: 'student', student })),
    { kind: 'gap' }, // so the write-in block reads as its own thing, not row n+1
    { kind: 'write-in-heading' },
    { kind: 'write-in' },
    { kind: 'write-in' },
  ]
}

function drawRoster(
  doc: PDFDocument,
  fonts: Fonts,
  packet: SessionPacket,
  columns: Column[],
  startPage: (title: string, standfirst: string) => number,
): void {
  const { students } = packet
  const title = 'Session roster'
  const standfirst =
    students.length === 0
      ? 'No papers were generated for this session. Anyone who turns up gets written in below.'
      : `${students.length} student${students.length === 1 ? '' : 's'}. Tick each one off as you check their BuzzCard, and hand each student only the paper printed with their own name.`

  const top = startPage(title, standfirst)
  let page = doc.getPage(doc.getPageCount() - 1)
  const rowsPerColumn = Math.max(1, Math.floor((top - FLOW_BOTTOM - 5) / ROSTER_ROW_H) + 1)
  const perPage = rowsPerColumn * columns.length
  const slots = rosterSlots(students)

  for (let i = 0; i < slots.length; i += perPage) {
    if (i > 0) {
      startPage(`${title}, continued`, standfirst)
      page = doc.getPage(doc.getPageCount() - 1)
    }
    for (const [j, slot] of slots.slice(i, i + perPage).entries()) {
      const col = columns[Math.floor(j / rowsPerColumn)]
      const y = top - (j % rowsPerColumn) * ROSTER_ROW_H
      if (slot.kind === 'student') {
        drawRosterRow(page, fonts, { x: col.x, y, width: col.width, student: slot.student })
      } else if (slot.kind === 'write-in-heading') {
        drawLabel(page, fonts, 'Not on this roster', { x: col.x, y: y - 2, size: 8, color: INK })
      } else if (slot.kind === 'write-in') {
        drawWriteInRow(page, { x: col.x, y, width: col.width })
      }
    }
  }
}

function drawRosterRow(
  page: PDFPage,
  fonts: Fonts,
  opts: { x: number; y: number; width: number; student: PacketStudent },
) {
  drawCheckbox(page, opts.x, opts.y)

  const identity = opts.student.identity ?? 'no GT ID'
  const identityW = fonts.regular.widthOfTextAtSize(printable(identity), 8.5)
  const nameW = opts.width - ROSTER_TEXT_X - identityW - 10

  // A name too long for its column is truncated rather than allowed to run into
  // the GT ID beside it — the ID is what check-in actually matches on.
  const lines = wrapLines(`${opts.student.lastName}, ${opts.student.firstName}`, fonts.regular, 9, nameW)
  drawText(page, lines.length > 1 ? `${lines[0]}...` : lines[0], {
    x: opts.x + ROSTER_TEXT_X,
    y: opts.y,
    size: 9,
    font: fonts.regular,
  })
  drawRightText(page, identity, { right: opts.x + opts.width, y: opts.y, size: 8.5, font: fonts.regular, color: MUTED })
  drawRule(page, opts.y - 5.5, opts.x, opts.width, 0.4)
}

/** An empty row in the same shape, for a student who turns up unexpectedly. */
function drawWriteInRow(page: PDFPage, opts: { x: number; y: number; width: number }) {
  drawCheckbox(page, opts.x, opts.y)
  drawRule(page, opts.y - 5.5, opts.x + ROSTER_TEXT_X, opts.width - ROSTER_TEXT_X, 0.75, RULE_STRONG)
}

const CHECKBOX = 9.5
const ROSTER_TEXT_X = CHECKBOX + 9

function drawCheckbox(page: PDFPage, x: number, y: number) {
  page.drawRectangle({
    x,
    y: y - 1.5,
    width: CHECKBOX,
    height: CHECKBOX,
    borderWidth: 0.75,
    borderColor: RULE_STRONG,
  })
}

function drawScript(
  doc: PDFDocument,
  fonts: Fonts,
  packet: SessionPacket,
  sections: InstructionSection[],
  columns: Column[],
  startPage: (title: string, standfirst: string) => number,
): void {
  const title = 'Proctor instructions'
  const standfirst = `${packet.examTitle}. Read this before the session starts.`

  const open = (heading: string): Flow => {
    const top = startPage(heading, standfirst)
    return {
      page: doc.getPage(doc.getPageCount() - 1),
      columns,
      index: 0,
      y: top,
      top,
      bottom: FLOW_BOTTOM,
    }
  }

  const SIZE = 9.5
  const LINE_H = 12.5
  const INDENT = 17
  const flow = open(title)

  for (const [s, section] of sections.entries()) {
    const width = column(flow).width
    const firstItem = wrapLines(section.items[0] ?? '', fonts.regular, SIZE, width - INDENT).length
    // A heading stranded at the foot of a column with nothing under it reads as
    // a mistake, so it moves together with its first item.
    if (s > 0 && !fits(flow, 30 + firstItem * LINE_H)) advance(flow, () => open(`${title}, continued`))

    const col = column(flow)
    drawLabel(flow.page, fonts, section.heading, { x: col.x, y: flow.y, size: 8.5, color: INK })
    flow.y -= 8
    drawRule(flow.page, flow.y, col.x, col.width, 0.6)
    flow.y -= 17

    for (const [i, item] of section.items.entries()) {
      const lines = wrapLines(item, fonts.regular, SIZE, column(flow).width - INDENT)
      if (!fits(flow, lines.length * LINE_H)) advance(flow, () => open(`${title}, continued`))

      const at = column(flow)
      drawText(flow.page, `${i + 1}`, { x: at.x, y: flow.y, size: SIZE, font: fonts.bold, color: MUTED })
      for (const line of lines) {
        drawText(flow.page, line, { x: at.x + INDENT, y: flow.y, size: SIZE, font: fonts.regular })
        flow.y -= LINE_H
      }
      flow.y -= 5
    }
    flow.y -= 13
  }
}

/** "Tuesday, October 27, 2026 · 1:35 PM · Scheller 101", or the exception label. */
function sessionHeaderLine(packet: SessionPacket): string {
  const date = formatSessionDate(packet.sessionAt)
  const time = formatSessionTime(packet.sessionAt)
  if (date && time) return `${date} · ${time}${packet.location ? ` · ${packet.location}` : ''}`
  return packet.sessionLabel
}

/** Same reason as padBooklet: duplex printing puts an odd last page's back to use. */
function padToEvenPages(doc: PDFDocument, fonts: Fonts): void {
  if (doc.getPageCount() % 2 === 0) return
  const page = doc.addPage(SHEET_SIZE)
  const size = 10
  drawText(page, BLANK_PAGE_NOTICE, {
    x: (PAGE_W - fonts.regular.widthOfTextAtSize(BLANK_PAGE_NOTICE, size)) / 2,
    y: PAGE_H / 2,
    size,
    font: fonts.regular,
    color: MUTED,
  })
}

/** Page numbers can only be stamped once the total is known. */
function stampPageNumbers(doc: PDFDocument, fonts: Fonts): void {
  const pages = doc.getPages()
  if (pages.length < 2) return
  for (const [i, page] of pages.entries()) {
    drawRightText(page, `${i + 1} / ${pages.length}`, {
      right: PAGE_W - MARGIN,
      y: MARGIN - 16,
      size: 7.5,
      font: fonts.regular,
      color: MUTED,
    })
  }
}
