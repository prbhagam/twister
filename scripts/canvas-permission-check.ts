/**
 * Probes each Canvas endpoint TWISTER uses, one at a time, and reports which your
 * token is allowed to call. Read-only: it never writes a grade.
 *
 * Run: npx tsx scripts/canvas-permission-check.ts <canvasCourseId> [assignmentId]
 */
import 'dotenv/config'
import { CanvasClient, CanvasError } from '../src/lib/canvas'

const [courseId, assignmentId] = process.argv.slice(2)
if (!courseId) {
  console.error('Usage: npx tsx scripts/canvas-permission-check.ts <canvasCourseId> [assignmentId]')
  console.error('Find the ids in the Canvas URL: .../courses/<courseId>/assignments/<assignmentId>')
  process.exit(1)
}

const client = CanvasClient.fromEnv()
if (!client) {
  console.error('Canvas is not configured. Set CANVAS_BASE_URL and CANVAS_TOKEN in .env')
  process.exit(1)
}

async function probe(label: string, needed: string, run: () => Promise<unknown>) {
  try {
    const result = await run()
    const count = Array.isArray(result) ? ` (${result.length} rows)` : ''
    console.log(`  ✓ ${label.padEnd(34)} allowed${count}`)
    return true
  } catch (error) {
    const status = error instanceof CanvasError ? error.status : '?'
    console.log(`  ✗ ${label.padEnd(34)} DENIED (${status}) — needs ${needed}`)
    return false
  }
}

console.log(`\nProbing course ${courseId}${assignmentId ? `, assignment ${assignmentId}` : ''}\n`)

console.log('Roster sync:')
const canListCourses = await probe('list your courses', 'course read access', () => client.listCourses())
const canListStudents = await probe('list students', 'roster read access', () =>
  client.listStudents(courseId),
)
await probe('list sections', 'course read access', () => client.listSections(courseId))

console.log('\nScore push:')
const canListAssignments = await probe('list assignments', 'assignment read access', () =>
  client.listAssignments(courseId),
)

let canReadSubmissions = false
if (assignmentId) {
  canReadSubmissions = await probe('read existing grades', '"Grades - view" / "Grades - edit"', () =>
    client.listSubmissions(courseId, assignmentId),
  )
} else {
  console.log('  – read existing grades                 skipped (pass an assignment id to test)')
}

console.log('\nSummary:')
if (canListCourses && canListStudents) {
  console.log('  Roster sync will work.')
} else {
  console.log('  Roster sync is blocked. Import the roster by CSV instead.')
}

if (!assignmentId) {
  console.log('  Score push: re-run with an assignment id to test it.')
} else if (canReadSubmissions && canListAssignments) {
  console.log(
    '  Score push should work — though writing grades needs "Grades - edit", which this\n' +
      '  read-only probe cannot confirm without actually posting a grade.',
  )
} else {
  console.log(
    '  Score push is blocked. This is a per-course role permission ("Grades - edit"), which\n' +
      '  TA roles commonly have withheld. Either ask a Canvas admin to grant it on this course,\n' +
      '  or use the Canvas CSV export and upload it through the Canvas gradebook import — that\n' +
      '  path needs no API permission at all.',
  )
}
console.log('')
