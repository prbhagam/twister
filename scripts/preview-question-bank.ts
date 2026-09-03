/**
 * Renders the question-bank PDF for one exam so the layout can be eyeballed.
 *
 * Run: npx tsx scripts/preview-question-bank.ts [examId] [outFile]
 *
 * With no exam id it takes the first exam in the database. READ-ONLY: it renders
 * to a file and writes nothing back.
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../src/lib/db'
import { bankTotals } from '../src/lib/pdf/question-bank'
import { buildQuestionBank, questionBankFileName, renderQuestionBankPdf } from '../src/lib/question-bank'

const examId = process.argv[2] ?? (await prisma.exam.findFirstOrThrow({ orderBy: { createdAt: 'asc' } })).id
const bank = await buildQuestionBank(examId)
if (!bank) throw new Error(`No exam with id ${examId}`)

const totals = bankTotals(bank)
console.log(`${bank.examTitle} — ${totals.questions} questions, ${totals.variations} variations, ${totals.points} points`)

const out = process.argv[3] ?? path.join(process.cwd(), 'output', questionBankFileName(bank.examTitle))
const pdf = await renderQuestionBankPdf(bank)
await writeFile(out, pdf)
console.log(`wrote ${out} (${(pdf.byteLength / 1024).toFixed(0)} KB)`)
