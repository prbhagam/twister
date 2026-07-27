/**
 * Reports which student identifiers your Canvas token can actually see, so the
 * choice of seeding identity is made from evidence rather than assumption.
 *
 * Prints counts and uniqueness only. Names are never printed; sample values are
 * redacted, so the output is safe to paste into a ticket.
 *
 * Run: npx tsx scripts/canvas-identity-check.ts <canvasCourseId>
 */
import 'dotenv/config'
import { CanvasClient } from '../src/lib/canvas'

const courseId = process.argv[2]
if (!courseId) {
  console.error('Usage: npx tsx scripts/canvas-identity-check.ts <canvasCourseId>')
  console.error('Find the id in the Canvas course URL: .../courses/<this number>')
  process.exit(1)
}

const client = CanvasClient.fromEnv()
if (!client) {
  console.error('Canvas is not configured. Set CANVAS_BASE_URL and CANVAS_TOKEN in .env')
  process.exit(1)
}

function redact(value: string | null | undefined): string {
  if (!value) return '(absent)'
  if (value.length <= 4) return `${value[0]}***`
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

const users = await client.listStudents(courseId)
console.log(`\nCanvas returned ${users.length} active students for course ${courseId}.\n`)

const fields = [
  { name: 'sis_user_id', get: (u: (typeof users)[number]) => u.sis_user_id },
  { name: 'login_id', get: (u: (typeof users)[number]) => u.login_id },
  { name: 'email', get: (u: (typeof users)[number]) => u.email },
  { name: 'id (Canvas internal)', get: (u: (typeof users)[number]) => String(u.id) },
]

console.log('field                  present   unique   sample')
console.log('-'.repeat(62))
for (const field of fields) {
  const values = users.map(field.get).filter((v): v is string => Boolean(v && String(v).trim()))
  const unique = new Set(values).size
  const sample = redact(values[0])
  console.log(
    `${field.name.padEnd(22)} ${String(values.length).padStart(5)}/${users.length}  ${String(unique).padStart(6)}   ${sample}`,
  )
}

const withSis = users.filter((u) => u.sis_user_id && /^\d{9}$/.test(String(u.sis_user_id)))
console.log('')

if (withSis.length === users.length) {
  console.log('GT IDs are fully available. Use the default identity — nothing to change.')
} else if (withSis.length > 0) {
  console.log(
    `Only ${withSis.length} of ${users.length} students have a 9-digit GT ID. A partial roster is the` +
      '\nworst case: some students would be seeded one way and some another. Resolve the' +
      '\npermission before generating.',
  )
} else {
  console.log(
    'No GT IDs visible to this token. This is a Canvas permission ("Users - view primary' +
      '\nemail address" / SIS data), not missing data — your Gradescope export contains GT IDs,' +
      '\nso they exist upstream. Ask a Canvas admin to grant SIS read, or import the roster by' +
      '\nCSV, or switch the seeding identity (see README, "Choosing the seeding identity").',
  )
}

const logins = users.map((u) => u.login_id).filter(Boolean)
if (new Set(logins).size !== users.length && logins.length > 0) {
  console.log(
    `\nWarning: login_id is not unique across this roster (${new Set(logins).size} distinct for ${users.length}` +
      '\nstudents). It cannot be used as a seeding identity.',
  )
}
