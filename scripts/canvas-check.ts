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
// Must be a *graded* run: an ungraded one reports every student as not_taken, which
// would make the push checks vacuously pass.
const run = await prisma.generationRun.findFirst({
  where: { imports: { some: { isActive: true } } },
  orderBy: { createdAt: 'desc' },
})
if (!run) {
  console.error('No graded run found. Run: npx tsx scripts/seed-grading.ts')
  process.exit(1)
}

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
    name: 'No Sis Id',
    sortable_name: 'Id, No Sis',
    sis_user_id: null,
    login_id: 'nosis3',
    email: 'nosis3@gatech.edu',
    enrollments: [{ course_section_id: 10, type: 'StudentEnrollment', enrollment_state: 'active' }],
  },
]

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
    // A handful already graded: two matching, one differing (a conflict).
    json([
      { user_id: 5000, score: null, grade: null, workflow_state: 'unsubmitted' },
      { user_id: 5001, score: 3, grade: '3', workflow_state: 'graded' },
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
  check('rejects the student with no SIS id', pulled.rejected.length === 1, pulled.rejected[0]?.reason)
  check('imports the rest', pulled.students.length === canvasUsers.length, `${pulled.students.length} students`)
  check('resolves section names', pulled.sections.every((s) => s.code.startsWith('CS 1301')))
  check(
    'every imported student keeps a 9-digit GT ID',
    pulled.students.every((s) => /^\d{9}$/.test(s.gtId ?? '')),
  )

  console.log('\n2. Roster diff against the database')
  const existing = seeded.map((s) => ({
    gtId: s.gtId,
    firstName: s.firstName,
    lastName: s.lastName,
    email: s.email,
    sections: JSON.parse(s.sections) as string[],
  }))
  const diff = diffRoster(existing, pulled.students)
  check('detects the late add', diff.added.length === 1 && diff.added[0].gtId === '903999999')
  check(
    'detects the drops',
    diff.removed.length === seeded.length - enrolled.length,
    `${diff.removed.length} no longer enrolled`,
  )
  check('reports section changes rather than silently rewriting', diff.changed.length > 0, `${diff.changed.length} field changes`)

  console.log('\n3. Grade push dry run')
  const { rows } = await loadScoreRows(run.id)
  const submissions = await client.listSubmissions('123', '777')
  const idByGtId = new Map(users.filter((u) => u.sis_user_id).map((u) => [String(u.sis_user_id), u.id] as const))
  const plan = planGradePush(rows, submissions, idByGtId)

  check('plans a push', plan.totalToPush > 0, `${plan.totalToPush} to push`)
  check('holds back absentees instead of zeroing them', plan.skippedNotTaken.length > 0, `${plan.skippedNotTaken.length} skipped`)
  check('flags the differing existing score as a conflict', plan.conflicts.length === 1, `Canvas had ${plan.conflicts[0]?.existing}`)
  check(
    'no absentee leaks into the push payload',
    !gradesToPush(plan).some((g) => plan.skippedNotTaken.some((s) => s.gtId === g.gtId)),
  )

  console.log('\n4. Push and progress polling')
  const started = await client.updateGrades('123', '777', gradesToPush(plan).slice(0, 3))
  const decoded = decodeURIComponent(gradePostBody)
  check('posts grades keyed by sis_user_id', /grade_data\[sis_user_id:\d{9}\]\[posted_grade\]=/.test(decoded))
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
