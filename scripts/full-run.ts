/** Generates the whole class, for timing and print-file sizing. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { createRun, executeRun, runDir, PRINT_FILE } from '../src/lib/generation'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

const exam = await prisma.exam.findFirstOrThrow({ where: { title: 'Exam 1' } })
const started = Date.now()
const { runId, studentCount } = await createRun({ examId: exam.id, sections: [], label: 'Full class' })
console.log(`run ${runId}: ${studentCount} students`)
await executeRun(runId)
const elapsed = (Date.now() - started) / 1000

const print = await readFile(path.join(runDir(runId), PRINT_FILE))
const exams = await prisma.studentExam.findMany({ where: { runId } })
const pages = exams.reduce((n, e) => n + (e.pageCount ?? 0), 0)

console.log(`done in ${elapsed.toFixed(0)}s (${(elapsed / studentCount).toFixed(2)}s/student)`)
console.log(`print file: ${pages} pages, ${(print.byteLength / 1024 / 1024).toFixed(1)} MB`)
await prisma.$disconnect()
