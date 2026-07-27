/**
 * Drives the Canvas client against a local stand-in for the Canvas API, over real
 * HTTP. The unit tests stub `fetch`; this exercises pagination via Link headers,
 * bearer auth, form encoding for the bulk grade update, and Progress polling.
 *
 * Run: npx tsx scripts/canvas-check.ts
 */
import 'dotenv/config'
import { createServer } from 'node:http'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client'
import { CanvasClient, diffRoster, fromCanvasRoster, gradesToPush, planGradePush } from '../src/lib/canvas'
import { loadScoreRows } from '../src/lib/run-data'

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }),
})

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

// Build the stand-in roster from real seeded students, so the diff is meaningful.
//
// Picks the run with the most *graded* students rather than the newest one. A run
// where everyone is not_taken — which is what importing the sample Gradescope
// export produces, since it contains exactly one graded row — would make the push
// checks pass vacuously.
const candidates = await prisma.generationRun.findMany({
  where: { imports: { some: { isActive: true } } },
  orderBy: { createdAt: 'desc' },
})

let run: (typeof candidates)[number] | null = null
let bestGraded = 0
for (const candidate of candidates) {
  const graded = await prisma.studentResult.count({
    where: { status: 'graded', import: { runId: candidate.id, isActive: true } },
  })
  if (graded > bestGraded) {
    bestGraded = graded
    run = candidate
  }
}

if (!run || bestGraded < 2) {
  console.error(
    `No run has at least 2 graded students (best: ${bestGraded}). Run: npx tsx scripts/seed-grading.ts`,
  )
  process.exit(1)
}
console.log(`Using run ${run.id} (${bestGraded} graded students)`)

// The stand-in roster is built from the graded run's own students, so the mock's
// existing submissions necessarily overlap the scores being pushed.
const seeded = (
  await prisma.studentExam.findMany({
    where: { runId: run.id },
    include: { student: true },
    orderBy: { student: { lastName: 'asc' } },
  })
).map((se) => se.student)

// Canvas "returns" the first 118 students, drops one, and adds a late enrollment.
const enrolled = seeded.slice(0, Math.max(1, seeded.length - 2))
const canvasUsers = enrolled.map((s, i) => ({
  id: 5000 + i,
  name: `${s.firstName} ${s.lastName}`,
  sortable_name: `${s.lastName}, ${s.firstName}`,
  sis_user_id: s.gtId ?? undefined,
  login_id: s.email.split('@')[0],
  email: s.email,
  enrollments: [
    { course_section_id: i % 2 === 0 ? 10 : 20, type: 'StudentEnrollment', enrollment_state: 'active' },
  ],
}))
canvasUsers.push({
  id: 9999,
  name: 'Late Add',
  sortable_name: 'Add, Late',
  sis_user_id: '903999999',
  login_id: 'ladd3',
  email: 'ladd3@gatech.edu',
  enrollments: [{ course_section_id: 10, type: 'StudentEnrollment', enrollment_state: 'active' }],
})
// One student Canvas cannot identify — must be rejected, never seeded on Canvas id.
const usersWithBadRow = [
  ...canvasUsers,
  {
    id: 8888,
    name: 'No Identifiers',
    sortable_name: 'Identifiers, No',
    sis_user_id: null,
    login_id: null,
    email: 'nosis3@gatech.edu',
    enrollments: [{ course_section_id: 10, type: 'StudentEnrollment', enrollment_state: 'active' }],
  },
]

// Which Canvas user ids carry an existing score in the mock. Chosen from students
// this run actually graded, so the conflict path is exercised no matter which
// students happened to be absent.
const { rows: allRows } = await loadScoreRows(run.id)
const gradedKeys = new Set(
  allRows.filter((r) => r.status === 'graded').map((r) => r.student.gtId ?? r.student.username),
)
const gradedCanvasIds = canvasUsers
  .filter((u) => gradedKeys.has(u.sis_user_id ?? u.login_id))
  .map((u) => u.id)
if (gradedCanvasIds.length < 2) {
  console.error('Need at least 2 graded students in the newest graded run.')
  process.exit(1)
}
const conflictUserIds = [gradedCanvasIds[0], gradedCanvasIds[1]]

let gradePostBody = ''
let progressPolls = 0

const server = createServer((req, res) => {
  const url = new URL(req.url!, 'http://localhost')
  const auth = req.headers.authorization

  if (auth !== 'Bearer test-token') {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ errors: [{ message: 'Invalid access token.' }] }))
    return
  }

  const json = (body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(200, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }

  // Paginate users 50 at a time to exercise Link-header following.
  if (url.pathname.endsWith('/users')) {
    const page = Number(url.searchParams.get('page') ?? '1')
    const size = 50
    const slice = usersWithBadRow.slice((page - 1) * size, page * size)
    const hasMore = page * size < usersWithBadRow.length
    json(
      slice,
      hasMore
        ? { link: `<http://localhost:${port}${url.pathname}?page=${page + 1}>; rel="next"` }
        : {},
    )
    return
  }

  if (url.pathname.endsWith('/sections')) {
    json([
      { id: 10, name: 'CS 1301 O1' },
      { id: 20, name: 'CS 1301 QH' },
    ])
    return
  }

  if (url.pathname.endsWith('/assignments')) {
    json([{ id: 777, name: 'Exam 1', points_possible: 13, published: true, post_manually: false }])
    return
  }

  if (url.pathname.endsWith('/submissions')) {
    // Existing Canvas scores are attached to students who were actually *graded* in
    // this run. Hardcoding the first two rows silently stops testing the conflict
    // path whenever those students happen to be absentees.
    json([
      { user_id: conflictUserIds[0], score: 999, grade: '999', workflow_state: 'graded' },
      { user_id: conflictUserIds[1], score: null, grade: null, workflow_state: 'unsubmitted' },
    ])
    return
  }

  if (url.pathname.endsWith('/update_grades')) {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      gradePostBody = body
      json({ id: 4242, workflow_state: 'queued', completion: 0 })
    })
    return
  }

  if (url.pathname.startsWith('/api/v1/progress/')) {
    progressPolls++
    json({
      id: 4242,
      workflow_state: progressPolls >= 2 ? 'completed' : 'running',
      completion: progressPolls >= 2 ? 100 : 40,
    })
    return
  }

  if (url.pathname === '/api/v1/courses') {
    json([{ id: 123, name: 'Introduction to Computing', course_code: 'CS 1301', term: { name: 'Summer 2026' } }])
    return
  }

  res.writeHead(404, { 'content-type': 'application/json' })
  res.end('{}')
})

const port = 8899
await new Promise<void>((resolve) => server.listen(port, resolve))

try {
  const client = new CanvasClient({ baseUrl: `http://localhost:${port}`, token: 'test-token' })

  console.log('\n1. Roster pull over real HTTP')
  const [users, sections] = await Promise.all([client.listStudents('123'), client.listSections('123')])
  check('paginates the roster correctly', users.length === usersWithBadRow.length, `${users.length} users`)

  const pulled = fromCanvasRoster(users, sections)
  check('rejects only the student with no identifier at all', pulled.rejected.length === 1, pulled.rejected[0]?.reason)
  check('imports everyone else', pulled.students.length === canvasUsers.length, `${pulled.students.length} students`)
  check('resolves section names', pulled.sections.every((s) => s.code.startsWith('CS 1301')))
  {
    // Only the students Canvas actually supplied an SIS id for should carry a GT ID;
    // the rest legitimately have none. Asserting "all" would just be asserting that
    // this particular run happened to come from a GT-ID roster.
    const suppliedGtId = usersWithBadRow.filter((u) => /^\d{9}$/.test(String(u.sis_user_id ?? '')))
    const keptGtId = pulled.students.filter((s) => /^\d{9}$/.test(s.gtId ?? ''))
    check(
      'keeps a 9-digit GT ID for exactly the students Canvas supplied one for',
      keptGtId.length === suppliedGtId.length && pulled.withGtId === suppliedGtId.length,
      `${keptGtId.length} kept, ${suppliedGtId.length} supplied`,
    )
    check(
      'every imported student carries at least one identifier',
      pulled.students.every((s) => s.gtId || s.username),
    )
  }

  const existingRows = seeded.map((s) => ({
    gtId: s.gtId,
    username: s.username,
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    sections: JSON.parse(s.sections) as string[],
  }))

  console.log('\n1b. A token with no SIS access (the real-world case)')
  // Same roster with every sis_user_id withheld, as Canvas returns it when the
  // token's role cannot read SIS data.
  const noSis = users.map((u) => ({ ...u, sis_user_id: null }))
  const withoutSis = fromCanvasRoster(noSis, sections)
  check(
    'still imports every student who has a login ID',
    withoutSis.students.length === pulled.students.length,
    `${withoutSis.students.length} students`,
  )
  check('records no GT IDs', withoutSis.withGtId === 0)
  check('records usernames instead', withoutSis.withUsername === withoutSis.students.length)
  check(
    'tells the operator to seed the exam on usernames',
    /seed on "GT username"/.test(withoutSis.errors[0] ?? ''),
  )
  {
    // The roster in the database was imported from CSV and carries GT IDs; this
    // pull carries only usernames. Matching on any shared identifier means the
    // overlap is recognised instead of the whole class reading as added+dropped.
    const d = diffRoster(existingRows, withoutSis.students)
    const withGtIdPull = diffRoster(existingRows, pulled.students)
    check(
      'a username-only pull matches the same students as a GT-ID pull',
      d.added.length === withGtIdPull.added.length && d.removed.length === withGtIdPull.removed.length,
      `added ${d.added.length} vs ${withGtIdPull.added.length}, removed ${d.removed.length} vs ${withGtIdPull.removed.length}`,
    )
    check(
      'the overlap is recognised rather than reported as a wholesale replacement',
      d.unchanged + d.changed.length > 0 && d.added.length === 1,
      `${d.unchanged} unchanged, ${d.changed.length} changed, ${d.added.length} added`,
    )
  }

  console.log('\n2. Roster diff against the database')
  const diff = diffRoster(existingRows, pulled.students)
  check('detects the late add', diff.added.length === 1 && diff.added[0].gtId === '903999999')
  check(
    'detects the drops',
    diff.removed.length === seeded.length - enrolled.length,
    `${diff.removed.length} no longer enrolled`,
  )
  check('reports section changes rather than silently rewriting', diff.changed.length > 0, `${diff.changed.length} field changes`)

  console.log('\n3. Grade push dry run')
  const rows = allRows
  const submissions = await client.listSubmissions('123', '777')
  // Indexed on both identifiers, mirroring canvasIdIndex() in the app.
  const idByGtId = new Map<string, number>()
  for (const u of users) {
    for (const k of [u.sis_user_id, u.login_id]) {
      if (k?.trim() && !idByGtId.has(k.trim())) idByGtId.set(k.trim(), u.id)
    }
  }
  const plan = planGradePush(rows, submissions, idByGtId)

  check('plans a push', plan.totalToPush > 0, `${plan.totalToPush} to push`)
  const absentees = allRows.filter((r) => r.status === 'not_taken').length
  if (absentees > 0) {
    check(
      'holds back absentees instead of zeroing them',
      plan.skippedNotTaken.length === absentees,
      `${plan.skippedNotTaken.length} of ${absentees} skipped`,
    )
  } else {
    console.log('  – holds back absentees                  skipped (this run has no absentees)')
  }
  check(
    'flags the differing existing score as a conflict',
    plan.conflicts.length === 1 && plan.conflicts[0]?.existing === 999,
    `Canvas had ${plan.conflicts[0]?.existing}`,
  )
  check(
    'no absentee leaks into the push payload',
    !gradesToPush(plan).some((g) => plan.skippedNotTaken.some((s) => s.gtId === g.key)),
  )

  console.log('\n4. Push and progress polling')
  const toPush = gradesToPush(plan).slice(0, 3)
  const started = await client.updateGrades('123', '777', toPush)
  const decoded = decodeURIComponent(gradePostBody)
  const usesGtId = toPush[0]?.kind === 'sis_user_id'
  check(
    `posts grades keyed by ${toPush[0]?.kind}`,
    usesGtId
      ? /grade_data\[sis_user_id:\d{9}\]\[posted_grade\]=/.test(decoded)
      : /grade_data\[sis_login_id:[^\]]+\]\[posted_grade\]=/.test(decoded),
  )
  check(
    'never addresses a username as an SIS user id',
    usesGtId || !decoded.includes('sis_user_id'),
  )
  check('does not send Canvas internal ids', !/grade_data\[\d{4}\]/.test(decoded))
  check('receives a Progress object', started.id === 4242 && started.workflow_state === 'queued')

  const finished = await client.waitForProgress(started.id, { intervalMs: 10 })
  check('polls until Canvas reports completion', finished.workflow_state === 'completed', `${progressPolls} polls`)

  console.log('\n5. Auth failure surfaces without leaking the token')
  const badClient = new CanvasClient({ baseUrl: `http://localhost:${port}`, token: 'wrong' })
  try {
    await badClient.listSections('123')
    check('rejects a bad token', false)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    check('rejects a bad token with a clear message', /rejected the token/i.test(message))
    check('error message contains no token material', !message.includes('wrong') && !message.includes('test-token'))
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
  process.exitCode = failures === 0 ? 0 : 1
} finally {
  server.close()
  await prisma.$disconnect()
}
