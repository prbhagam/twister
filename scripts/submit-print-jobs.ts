/**
 * Submits one print job per student, so a release system that applies finishing
 * per job (Canon uniFLOW, PaperCut) can staple each booklet separately. A single
 * merged file is one job, and gets one staple.
 *
 * Finishing is NOT set here. Under uniFLOW you choose duplex and stapling at the
 * device when releasing, and those settings apply to each released job — so this
 * only has to get the jobs into the queue, correctly named and correctly ordered.
 *
 * Prints nothing unless --send is passed. Test with a handful first:
 *
 *   npx tsx scripts/submit-print-jobs.ts --printer hollister_cc_gatech_edu --limit 3
 *   npx tsx scripts/submit-print-jobs.ts --printer hollister_cc_gatech_edu --limit 3 --send
 *
 * Release those three at the copier with stapling on. If you get three stapled
 * booklets, the whole run will work; if you get one, your uniFLOW merges jobs and
 * hand-stapling is the answer.
 */
import 'dotenv/config'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { runDir } from '../src/lib/generation'
import { byLastName } from '../src/lib/roster'

const run = promisify(execFile)

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}
const has = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const printer = arg('printer')
  const send = has('send')
  const limit = Number(arg('limit') ?? Number.POSITIVE_INFINITY)
  const delayMs = Number(arg('delay') ?? 250)

  if (!printer) {
    console.error('Missing --printer. Available:')
    const { stdout } = await run('lpstat', ['-p']).catch(() => ({ stdout: '' }))
    console.error(stdout.replace(/^printer /gm, '  '))
    process.exitCode = 1
    return
  }

  const runId =
    arg('run') ??
    (
      await prisma.generationRun.findFirstOrThrow({
        where: { status: 'completed' },
        orderBy: { createdAt: 'desc' },
      })
    ).id

  const generationRun = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: { studentExams: { include: { student: true } } },
  })

  const ordered = generationRun.studentExams
    .filter((se) => se.pdfPath)
    .sort((a, b) => byLastName(a.student, b.student))
    .slice(0, limit)

  const dir = runDir(runId)
  const missing = ordered.filter((se) => !existsSync(path.join(dir, se.pdfPath!)))
  if (missing.length) {
    console.error(`${missing.length} PDF(s) are missing from ${dir}. Regenerate the run first.`)
    process.exitCode = 1
    return
  }

  console.log(`\nrun ${runId}`)
  console.log(`  ${ordered.length} job(s) to ${printer}${send ? '' : '  [DRY RUN — nothing sent]'}`)
  console.log(`  released in last-name order, ${delayMs}ms apart\n`)

  let sent = 0
  for (const se of ordered) {
    const file = path.join(dir, se.pdfPath!)
    // The job title is what you see in the uniFLOW release list, so make it the
    // student rather than a filename.
    const title = `${se.student.lastName}, ${se.student.firstName} — ${generationRun.examTitle}`
    const args = ['-d', printer, '-t', title, file]

    if (!send) {
      if (sent < 5 || sent === ordered.length - 1) console.log(`  lp ${args.map(quote).join(' ')}`)
      else if (sent === 5) console.log(`  … ${ordered.length - 6} more`)
      sent++
      continue
    }

    try {
      await run('lp', args)
      sent++
      if (sent % 25 === 0 || sent === ordered.length) {
        console.log(`  submitted ${sent}/${ordered.length}`)
      }
    } catch (error) {
      console.error(`  FAILED for ${title}: ${error instanceof Error ? error.message : error}`)
      console.error(`  Stopping. ${sent} job(s) were submitted; cancel them with: cancel -a ${printer}`)
      process.exitCode = 1
      return
    }

    // A queue handed 404 jobs at once tends to drop some.
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
  }

  if (!send) {
    console.log(`\n  Re-run with --send to submit. Start with --limit 3.`)
  } else {
    console.log(`\n  ${sent} job(s) queued. Release them at the copier with duplex and stapling on.`)
    console.log(`  To clear the queue if something looks wrong: cancel -a ${printer}`)
  }
  console.log('')
}

function quote(value: string): string {
  return /[^\w./-]/.test(value) ? `'${value.replace(/'/g, "'\\''")}'` : value
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
