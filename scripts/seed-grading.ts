/**
 * Writes a synthetic Gradescope import for the newest run so the grading, review,
 * and export screens can be exercised without a real scan.
 *
 * Mirrors the writes that `commitGrading` performs in the app.
 *
 * Run: npx tsx scripts/seed-grading.ts

 * WRITES to whichever database DATABASE_URL points at (writes a grading import). Use `npm run
 * verify`, which points every check at a throwaway verify.db, rather than running
 * this against a database holding real exams.
 */
import 'dotenv/config'
import Papa from 'papaparse'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { gradeStudent, matchStudents, parseGradescopeCsv } from '../src/lib/grading'
import type { LayoutEntry } from '../src/lib/seed'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

const run = await prisma.generationRun.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })
const positions = await prisma.runQuestion.count({ where: { runId: run.id } })
const studentExams = await prisma.studentExam.findMany({
  where: { runId: run.id },
  include: { student: true },
  orderBy: { student: { lastName: 'asc' } },
})

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

// A plausible spread: most students get most answers right, a few leave blanks or
// double-bubble, and ~4% never hand in a sheet.
let rngState = 12345
const rand = () => {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
  return rngState / 0x7fffffff
}

const data = studentExams.map((se, i) => {
  const layout = (JSON.parse(se.layout) as LayoutEntry[]).sort((a, b) => a.position - b.position)
  const missing = i % 25 === 7

  const row: (string | number)[] = [
    se.student.firstName,
    se.student.lastName,
    // Keyed on whichever identifier this student actually has, as a real
    // Gradescope export would be.
    se.student.gtId ?? se.student.username ?? se.student.email,
    se.student.email,
    '',
    missing ? 'Missing' : 'Graded',
    missing ? '--' : `4116${i}`,
    positions,
    '',
  ]

  for (const entry of layout) {
    let response = entry.correctLetter ?? 'A'
    if (!missing) {
      const roll = rand()
      if (roll < 0.03) response = ''
      else if (roll < 0.05) response = 'A;C'
      else if (roll < 0.07 && entry.choiceCount < 5) response = 'E'
      else if (roll < 0.28) {
        const options = ['A', 'B', 'C', 'D', 'E'].slice(0, entry.choiceCount)
        response = options.find((l) => l !== entry.correctLetter) ?? 'A'
      }
    } else {
      response = ''
    }
    row.push('', 1, response, 'A')
  }
  return row
})

const csv = Papa.unparse({ fields, data })
const parsed = parseGradescopeCsv(csv)
const report = matchStudents(
  parsed.rows,
  studentExams.map((se) => ({
    studentExamId: se.id,
    gtId: se.student.gtId,
    firstName: se.student.firstName,
    lastName: se.student.lastName,
    email: se.student.email,
  })),
)

await prisma.gradingImport.updateMany({ where: { runId: run.id }, data: { isActive: false } })
const record = await prisma.gradingImport.create({
  data: {
    runId: run.id,
    filename: 'synthetic-gradescope-export.csv',
    matched: report.matched.length,
    unmatched: JSON.stringify({
      csvOnly: report.csvOnly,
      rosterOnly: report.rosterOnly,
      missingStatus: report.missingStatus,
    }),
    isActive: true,
  },
})

const byId = new Map(studentExams.map((se) => [se.id, se]))
let graded = 0
for (const { studentExamId, row } of report.matched) {
  const se = byId.get(studentExamId)!
  const result = gradeStudent({
    layout: JSON.parse(se.layout) as LayoutEntry[],
    responses: row.responses,
    status: row.status,
  })
  await prisma.studentResult.create({
    data: {
      importId: record.id,
      studentExamId,
      status: result.status,
      earned: result.earned,
      possible: result.possible,
      questions: {
        create: result.questions.map((q) => ({
          position: q.position,
          rawResponse: q.rawResponse,
          letters: JSON.stringify(q.letters),
          verdict: q.verdict,
          awarded: q.awarded,
          possible: q.possible,
        })),
      },
    },
  })
  graded++
}

console.log(`run ${run.id}: graded ${graded} students (${report.missingStatus} missing)`)
await prisma.$disconnect()
