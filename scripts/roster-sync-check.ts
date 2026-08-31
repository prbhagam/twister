/**
 * Checks that re-importing a roster reconciles it: students missing from the new
 * import are dropped from the roster, returning students are restored, and neither
 * touches the graded exams of anyone who already sat one.
 *
 * Run: npx tsx scripts/roster-sync-check.ts
 *
 * WRITES to whichever database DATABASE_URL points at (creates and deletes a
 * throwaway course). Use `npm run verify`, which points every check at verify.db.
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { reconcileDroppedStudents } from '../src/lib/roster-sync'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

let failures = 0
function check(condition: unknown, description: string) {
  if (condition) console.log(`  ✓ ${description}`)
  else { console.error(`  ✗ ${description}`); failures++ }
}

async function activeCount(courseId: string) {
  return prisma.student.count({ where: { courseId, droppedAt: null } })
}

async function main() {
  const course = await prisma.course.create({ data: { name: `ROSTER SYNC CHECK ${Date.now()}` } })
  const enrol = (gtId: string, lastName: string) =>
    prisma.student.create({
      data: { courseId: course.id, gtId, username: gtId, firstName: 'Test', lastName, email: `${gtId}@example.edu`, sections: '["A"]' },
    })

  const stays = await enrol('900000001', 'Stays')
  const returns = await enrol('900000002', 'Returns')
  const satExam = await enrol('900000003', 'SatExam')

  // The student who drops has already sat a graded exam — the case that makes a
  // hard delete unacceptable.
  const exam = await prisma.exam.create({ data: { courseId: course.id, title: 'Exam 1', instructorSeed: 'seed' } })
  const run = await prisma.generationRun.create({ data: { examId: exam.id, seedUsed: 'seed' } })
  await prisma.studentExam.create({ data: { runId: run.id, studentId: satExam.id, traceCode: 'TRACE1', layout: '[]' } })

  console.log('re-import missing two of the three students:')
  let result = await reconcileDroppedStudents(prisma, course.id, [stays.gtId!])
  check(result.dropped === 2 && result.restored === 0, `reports 2 dropped, 0 restored (got ${result.dropped}/${result.restored})`)
  check((await activeCount(course.id)) === 1, 'roster counts 1 student')
  check((await prisma.student.count({ where: { courseId: course.id } })) === 3, 'all 3 student rows still exist')
  check((await prisma.studentExam.count({ where: { studentId: satExam.id } })) === 1, "dropped student's graded exam survives")

  console.log('re-import in which one dropped student re-enrols:')
  result = await reconcileDroppedStudents(prisma, course.id, [stays.gtId!, returns.gtId!])
  check(result.dropped === 0 && result.restored === 1, `reports 0 dropped, 1 restored (got ${result.dropped}/${result.restored})`)
  check((await activeCount(course.id)) === 2, 'roster counts 2 students')

  console.log('an empty import never empties the roster:')
  result = await reconcileDroppedStudents(prisma, course.id, [])
  check(result.dropped === 0 && (await activeCount(course.id)) === 2, 'roster still counts 2 students')

  console.log('a student with no GT ID cannot be matched, so is left alone:')
  await prisma.student.create({
    data: { courseId: course.id, gtId: null, username: 'nogtid', firstName: 'No', lastName: 'GtId', email: 'nogtid@example.edu', sections: '[]' },
  })
  await reconcileDroppedStudents(prisma, course.id, [stays.gtId!, returns.gtId!])
  const unmatched = await prisma.student.findFirst({ where: { courseId: course.id, username: 'nogtid' } })
  check(unmatched?.droppedAt === null, 'null-gtId student is not dropped')

  await prisma.course.delete({ where: { id: course.id } })
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll roster sync checks passed.')
  if (failures) process.exitCode = 1
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
