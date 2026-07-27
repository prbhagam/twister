/**
 * Produces filled-in bubble sheets for a generation run, as if the class had sat
 * the exam and the sheets had been scanned. Upload the merged PDF to Gradescope to
 * exercise the whole loop: OCR -> export -> TWISTER grading.
 *
 * Deliberately seeds the cases that are awkward to produce by hand:
 *   - students with no sheet at all (Gradescope reports them Missing)
 *   - blanks, double-bubbles, and a letter past the end of a short variation
 *
 * Output goes to <TWISTER_OUTPUT_DIR>/<runId>-scans/, which is gitignored. The
 * sheets carry real student names and IDs, so they are FERPA-protected — do not
 * commit them or send them anywhere.
 *
 * Run: npx tsx scripts/make-sample-scans.ts [runId]
 */
import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHmac } from 'node:crypto'
import Papa from 'papaparse'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { BUBBLE_SHEET_PATH, SHEET_SIZE, drawStudentFields } from '../src/lib/pdf/bubble-sheet'
import { identityValue, parseIdentityField } from '../src/lib/identity'
import { outputRoot } from '../src/lib/generation'
import { LETTERS, sfc32, type LayoutEntry } from '../src/lib/seed'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

// --- bubble grid -------------------------------------------------------------
//
// Read off the template rather than guessed: the letter glyphs sit at 18pt
// intervals in four blocks, rows are 17pt apart, and every fifth row is followed
// by a ~35pt gap. Coordinates below are top-left, converted to PDF space on use.

const BLOCK_X = [81, 210, 340, 469]
const LETTER_DX = 18
const ROW_PITCH = 17
const FIRST_ROW_Y = 236.69
// Every fifth row is followed by a visual break. Measured row-to-row deltas across
// a break are 35/36pt against a normal pitch of 17, so the *extra* is 18/19 — the
// break does not stack on top of a full pitch.
const GROUP_EXTRA = [18, 19, 18, 19] // after rows 5, 10, 15, 20 of each block

function rowY(indexInBlock: number): number {
  let y = FIRST_ROW_Y + indexInBlock * ROW_PITCH
  for (let g = 0; g < GROUP_EXTRA.length; g++) {
    if (indexInBlock > (g + 1) * 5 - 1) y += GROUP_EXTRA[g]
  }
  return y
}

/** Centre of the bubble for question `q` (1-100), letter index 0-4, in PDF space. */
function bubbleCentre(q: number, letter: number): { x: number; y: number } {
  const block = Math.floor((q - 1) / 25)
  const indexInBlock = (q - 1) % 25
  return {
    x: BLOCK_X[block] + letter * LETTER_DX,
    y: SHEET_SIZE[1] - rowY(indexInBlock),
  }
}

// --- response simulation -----------------------------------------------------

type Flag = 'blank' | 'multi' | 'out_of_range' | 'wrong'

interface Sheet {
  studentExamId: string
  name: string
  identity: string
  /** question position -> letters bubbled (empty = left blank) */
  marks: Map<number, string[]>
  flags: Flag[]
}

function rng(seed: string) {
  return sfc32(createHmac('sha256', 'sample-scans').update(seed).digest())
}

async function main() {
  const runId =
    process.argv[2] ??
    (
      await prisma.generationRun.findFirstOrThrow({
        where: { status: 'completed' },
        orderBy: { createdAt: 'desc' },
      })
    ).id

  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: { studentExams: { include: { student: true } } },
  })
  const identityField = parseIdentityField(run.identityField)

  const ordered = run.studentExams
    .slice()
    .sort((a, b) => a.student.lastName.localeCompare(b.student.lastName))

  // ~6% of the class never hands in a sheet.
  const absentEvery = 17
  const sheets: Sheet[] = []
  const absent: { name: string; identity: string }[] = []
  const flagTally: Record<Flag, number> = { blank: 0, multi: 0, out_of_range: 0, wrong: 0 }

  ordered.forEach((se, i) => {
    const identity = identityValue(se.student, identityField) ?? ''
    const name = `${se.student.firstName} ${se.student.lastName}`
    if (i % absentEvery === 0) {
      absent.push({ name, identity })
      return
    }

    const layout = (JSON.parse(se.layout) as LayoutEntry[]).sort((a, b) => a.position - b.position)
    const rand = rng(se.id)
    const marks = new Map<number, string[]>()
    const flags: Flag[] = []

    for (const entry of layout) {
      const available = LETTERS.slice(0, entry.choiceCount)
      const wrongOnes = available.filter((l) => l !== entry.correctLetter)
      const roll = rand()

      if (roll < 0.03) {
        marks.set(entry.position, []) // left blank
        flags.push('blank')
        flagTally.blank++
      } else if (roll < 0.055) {
        const other = wrongOnes[Math.floor(rand() * wrongOnes.length)] ?? 'B'
        marks.set(entry.position, [entry.correctLetter ?? 'A', other].sort())
        flags.push('multi')
        flagTally.multi++
      } else if (roll < 0.075 && entry.choiceCount < LETTERS.length) {
        // A letter that was never printed on this student's paper.
        marks.set(entry.position, [LETTERS[LETTERS.length - 1]])
        flags.push('out_of_range')
        flagTally.out_of_range++
      } else if (roll < 0.28) {
        marks.set(entry.position, [wrongOnes[Math.floor(rand() * wrongOnes.length)] ?? 'A'])
        flags.push('wrong')
        flagTally.wrong++
      } else {
        marks.set(entry.position, [entry.correctLetter ?? 'A'])
      }
    }

    sheets.push({ studentExamId: se.id, name, identity, marks, flags })
  })

  // --- render ---------------------------------------------------------------

  const dir = path.join(outputRoot(), `${runId}-scans`)
  await mkdir(dir, { recursive: true })

  const { readFile } = await import('node:fs/promises')
  const templateBytes = new Uint8Array(await readFile(BUBBLE_SHEET_PATH))

  const merged = await PDFDocument.create()
  const [sheetTemplate] = await merged.embedPdf(templateBytes, [0])
  const font = await merged.embedFont(StandardFonts.Helvetica)
  const ink = rgb(0.05, 0.05, 0.08)

  for (const sheet of sheets) {
    const page = merged.addPage(SHEET_SIZE)
    page.drawPage(sheetTemplate, { x: 0, y: 0, width: SHEET_SIZE[0], height: SHEET_SIZE[1] })
    drawStudentFields(page, font, { name: sheet.name, gtId: sheet.identity })

    for (const [position, letters] of sheet.marks) {
      for (const letter of letters) {
        const index = LETTERS.indexOf(letter as (typeof LETTERS)[number])
        if (index === -1) continue
        const { x, y } = bubbleCentre(position, index)
        // Slightly under the printed ring so the outline stays visible, which is
        // what a pencil fill actually looks like to the scanner.
        page.drawEllipse({ x, y, xScale: 4.6, yScale: 4.6, color: ink })
      }
    }
  }

  const mergedPath = path.join(dir, 'filled-sheets-all.pdf')
  await writeFile(mergedPath, await merged.save())

  // --- the Gradescope export those sheets should produce --------------------

  const positions = Math.max(...sheets.map((s) => s.marks.size))
  const fields = [
    'First Name',
    'Last Name',
    'Student ID',
    'Email',
    'Sections',
    'Status',
    'Submission ID',
    'Max Points',
    'Total Score',
    ...Array.from({ length: positions }, (_, i) => [
      `Question ${i + 1} Score`,
      `Question ${i + 1} Weight`,
      `Question ${i + 1} Student Response(s)`,
      `Question ${i + 1} Correct Response`,
    ]).flat(),
  ]

  const byId = new Map(run.studentExams.map((se) => [se.id, se]))
  const rows = sheets.map((sheet, i) => {
    const se = byId.get(sheet.studentExamId)!
    const row: (string | number)[] = [
      se.student.firstName,
      se.student.lastName,
      sheet.identity,
      se.student.email,
      '',
      'Graded',
      `9${String(i).padStart(6, '0')}`,
      positions,
      '',
    ]
    for (let p = 1; p <= positions; p++) {
      row.push('', 1, (sheet.marks.get(p) ?? []).join(';'), 'A')
    }
    return row
  })

  // Absent students appear in a real export too, marked Missing.
  for (const person of absent) {
    const se = ordered.find((s) => identityValue(s.student, identityField) === person.identity)!
    const row: (string | number)[] = [
      se.student.firstName,
      se.student.lastName,
      person.identity,
      se.student.email,
      '',
      'Missing',
      '--',
      '--',
      '--',
    ]
    rows.push(row)
  }

  const csvPath = path.join(dir, 'expected-gradescope-export.csv')
  await writeFile(csvPath, Papa.unparse({ fields, data: rows }), 'utf8')

  console.log(`\nrun ${runId} — ${run.studentExams.length} students, ${positions} questions`)
  console.log(`  sheets filled : ${sheets.length}`)
  console.log(`  no sheet      : ${absent.length}  (will import as Missing)`)
  console.log(`  flagged marks : ${flagTally.blank} blank, ${flagTally.multi} double-bubbled, ${flagTally.out_of_range} out-of-range`)
  console.log(`  wrong answers : ${flagTally.wrong}`)
  console.log(`\n  ${mergedPath}`)
  console.log(`  ${csvPath}`)
  console.log('\nThese carry real student names and IDs. Do not commit them.\n')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
