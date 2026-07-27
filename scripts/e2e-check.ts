/**
 * End-to-end check against the seeded database: generate a run, verify the PDFs,
 * synthesize a Gradescope export with known errors injected, grade it, and confirm
 * the resulting scores by hand.
 *
 * Run: npx tsx scripts/e2e-check.ts [sectionLabel]
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import Papa from 'papaparse'
import { PDFDocument } from 'pdf-lib'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { createRun, executeRun, runDir, PRINT_FILE } from '../src/lib/generation'
import {
  checkPositionCoverage,
  gradeStudent,
  matchStudents,
  parseGradescopeCsv,
} from '../src/lib/grading'
import { sectionLabel } from '../src/lib/roster'
import type { LayoutEntry } from '../src/lib/seed'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

const wanted = process.argv[2] ?? 'HP'
let failures = 0

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

async function main() {
  const exam = await prisma.exam.findFirstOrThrow({
    where: { title: 'Exam 1' },
    include: { course: { include: { students: true } }, questions: true },
  })

  const sections = new Set<string>()
  for (const student of exam.course.students) {
    for (const code of JSON.parse(student.sections) as string[]) sections.add(code)
  }
  const section = [...sections].find((code) => sectionLabel(code) === wanted)
  if (!section) throw new Error(`No section labelled ${wanted}. Found: ${[...sections].map(sectionLabel).join(', ')}`)

  console.log(`\n1. Generating for section ${wanted} (${section})`)
  const started = Date.now()
  const { runId, studentCount } = await createRun({ examId: exam.id, sections: [section], label: `e2e ${wanted}` })
  console.log(`   run ${runId}, ${studentCount} students`)
  await executeRun(runId)
  const elapsed = (Date.now() - started) / 1000
  console.log(`   rendered in ${elapsed.toFixed(1)}s (${(elapsed / studentCount).toFixed(2)}s/student)`)

  const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } })
  check('run completed', run.status === 'completed', run.error ?? '')
  check('all students rendered', run.completedCount === studentCount, `${run.completedCount}/${studentCount}`)

  console.log('\n2. Verifying PDFs')
  const studentExams = await prisma.studentExam.findMany({
    where: { runId },
    include: { student: true },
    orderBy: { student: { lastName: 'asc' } },
  })

  check('every student has a PDF path', studentExams.every((se) => se.pdfPath))

  const dir = runDir(runId)
  const first = studentExams[0]
  const firstBytes = await readFile(path.join(dir, first.pdfPath!))
  const firstDoc = await PDFDocument.load(new Uint8Array(firstBytes))

  check('PDF has a cover page plus questions', firstDoc.getPageCount() >= 3, `${firstDoc.getPageCount()} pages`)
  const page1 = firstDoc.getPage(0).getSize()
  check('page 1 is Letter-sized', Math.round(page1.width) === 612 && Math.round(page1.height) === 792)

  // The bubble sheet is ~227 KB of vector art; a blank or regenerated page 1 would
  // make the whole file far smaller.
  const template = await readFile(path.join(process.cwd(), 'assets', 'Gradescope Bubble Sheet.pdf'))
  check(
    'page 1 carries the bubble sheet artwork',
    firstBytes.byteLength > template.byteLength * 0.5,
    `${(firstBytes.byteLength / 1024).toFixed(0)} KB vs template ${(template.byteLength / 1024).toFixed(0)} KB`,
  )

  const printBytes = await readFile(path.join(dir, PRINT_FILE))
  const printDoc = await PDFDocument.load(new Uint8Array(printBytes))
  const expectedPages = studentExams.reduce((n, se) => n + (se.pageCount ?? 0), 0)
  check(
    'merged print file has every page',
    printDoc.getPageCount() === expectedPages,
    `${printDoc.getPageCount()} pages, ${(printBytes.byteLength / 1024 / 1024).toFixed(1)} MB`,
  )

  console.log('\n3. Verifying uniqueness')
  const layouts = studentExams.map((se) => JSON.parse(se.layout) as LayoutEntry[])
  const fingerprints = new Set(layouts.map((l) => JSON.stringify(l)))
  check('every student got a distinct paper', fingerprints.size === layouts.length, `${fingerprints.size}/${layouts.length}`)
  check('every paper has all questions', layouts.every((l) => l.length === exam.questions.length))

  const keyStrings = new Set(layouts.map((l) => l.map((e) => e.correctLetter).join('')))
  check('answer keys differ across students', keyStrings.size > layouts.length * 0.9, `${keyStrings.size} distinct keys`)

  const orderStrings = new Set(layouts.map((l) => l.map((e) => e.runQuestionId).join()))
  check('question orders differ across students', orderStrings.size > layouts.length * 0.9, `${orderStrings.size} distinct orders`)

  console.log('\n4. Synthesizing a Gradescope export with known errors')
  // Errors injected into the first student only: a blank, a multi-mark, an
  // out-of-range letter, and three wrong answers.
  const target = studentExams[0]
  const targetLayout = layouts[0]
  const positions = exam.questions.length

  const wrongLetter = (entry: LayoutEntry) => {
    const options = ['A', 'B', 'C', 'D', 'E'].slice(0, entry.choiceCount)
    return options.find((l) => l !== entry.correctLetter) ?? 'A'
  }

  const shortQuestion = targetLayout.find((e) => e.choiceCount < 5)
  const injected = new Map<number, string>()
  injected.set(targetLayout[0].position, '') // blank
  injected.set(targetLayout[1].position, 'A;B') // multi-mark
  if (shortQuestion) injected.set(shortQuestion.position, 'E') // out of range
  for (const entry of targetLayout.slice(2, 5)) {
    if (!injected.has(entry.position)) injected.set(entry.position, wrongLetter(entry))
  }
  const expectedTargetScore = targetLayout
    .filter((e) => !injected.has(e.position))
    .reduce((sum, e) => sum + e.points, 0)

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

  const data = studentExams.map((se, i) => {
    const layout = layouts[i]
    const byPosition = new Map(layout.map((e) => [e.position, e]))
    const isTarget = se.id === target.id
    // One student is left unscanned, to exercise the not_taken path.
    const missing = i === 1

    const row: (string | number)[] = [
      se.student.firstName,
      se.student.lastName,
      se.student.gtId ?? '',
      se.student.email,
      '',
      missing ? 'Missing' : 'Graded',
      missing ? '--' : `4116${i}`,
      positions,
      '',
    ]
    for (let p = 1; p <= positions; p++) {
      const entry = byPosition.get(p)!
      const response = missing
        ? ''
        : isTarget && injected.has(p)
          ? injected.get(p)!
          : (entry.correctLetter ?? 'A')
      // Gradescope's own "correct response" is deliberately wrong here — TWISTER
      // must ignore it and use the run's own key.
      row.push('', 1, response, 'A')
    }
    return row
  })

  const csv = Papa.unparse({ fields, data })

  console.log('\n5. Grading the synthesized export')
  const parsed = parseGradescopeCsv(csv)
  check('response columns discovered', parsed.positions.length === positions, `${parsed.positions.length} columns`)
  check('coverage check passes', checkPositionCoverage(parsed.positions, positions) === null)
  check(
    'a 10-column CSV against this run is rejected',
    checkPositionCoverage([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], positions) !== null,
  )

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
  check('every student matched on GT ID', report.matched.length === studentExams.length)
  check('no unmatched rows either direction', report.csvOnly.length === 0 && report.rosterOnly.length === 0)

  const layoutById = new Map(studentExams.map((se, i) => [se.id, layouts[i]]))
  let perfectScores = 0
  let notTaken = 0
  let targetResult: ReturnType<typeof gradeStudent> | null = null

  for (const { studentExamId, row } of report.matched) {
    const result = gradeStudent({
      layout: layoutById.get(studentExamId)!,
      responses: row.responses,
      status: row.status,
    })
    if (studentExamId === target.id) targetResult = result
    if (result.status === 'not_taken') notTaken++
    else if (result.earned === result.possible) perfectScores++
  }

  const totalPoints = targetLayout.reduce((sum, e) => sum + e.points, 0)
  check('the unscanned student is recorded as not taken', notTaken === 1)
  check(
    'students who marked the key score full marks',
    perfectScores === studentExams.length - 2,
    `${perfectScores} of ${studentExams.length - 2}`,
  )

  const verdicts = targetResult!.questions.map((q) => q.verdict)
  check('blank detected', verdicts.filter((v) => v === 'blank').length === 1)
  check('multi-mark detected', verdicts.filter((v) => v === 'multi').length === 1)
  if (shortQuestion) {
    check('out-of-range letter detected', verdicts.filter((v) => v === 'out_of_range').length === 1)
  }
  check(
    'injected wrong answers scored incorrect',
    verdicts.filter((v) => v === 'incorrect').length === injected.size - (shortQuestion ? 3 : 2),
  )
  check(
    'injected student scores exactly the hand-computed total',
    targetResult!.earned === expectedTargetScore,
    `${targetResult!.earned} of ${totalPoints}, expected ${expectedTargetScore}`,
  )

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  console.log(`Run id: ${runId}`)
  process.exitCode = failures === 0 ? 0 : 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
