import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { sectionLabel } from '@/lib/roster'
import { Badge, Button, Card, CardHeader, Empty, Input, Label } from '@/components/ui'
import { CanvasClient, staffRoleFor } from '@/lib/canvas'
import { DangerZone } from '@/components/DangerZone'
import { createExam, deleteCourse } from '../../actions'
import { CanvasSync } from './CanvasSync'
import { RosterUpload } from './RosterUpload'

export const dynamic = 'force-dynamic'

/**
 * Canvas courses for the picker. A Canvas outage or a bad token must not take the
 * course page down, so the failure is returned and rendered in place.
 */
async function loadCanvasCourses() {
  const client = CanvasClient.fromEnv()
  if (!client) return null

  try {
    const courses = await client.listCourses()
    return {
      courses: courses.map((c) => ({
        id: String(c.id),
        name: c.course_code ? `${c.course_code} — ${c.name}` : c.name,
        // Shown so a course you TA is distinguishable from one you teach.
        term: [c.term?.name, staffRoleFor(c) === 'ta' ? 'TA' : staffRoleFor(c) === 'designer' ? 'Designer' : null]
          .filter(Boolean)
          .join(' · '),
      })),
      error: null,
    }
  } catch (error) {
    return { courses: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      exams: { orderBy: { updatedAt: 'desc' }, include: { _count: { select: { questions: true, runs: true } } } },
      students: { orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] },
      rosterImports: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  if (!course) notFound()

  const canvas = await loadCanvasCourses()

  const sections = new Map<string, number>()
  for (const student of course.students) {
    for (const code of JSON.parse(student.sections) as string[]) {
      sections.set(code, (sections.get(code) ?? 0) + 1)
    }
  }
  const lastImport = course.rosterImports[0]

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-slate-500 hover:underline">
          ← All courses
        </Link>
        <h1 className="mt-1 text-lg font-semibold">
          {course.name}
          {course.title ? <span className="font-normal text-slate-500"> — {course.title}</span> : null}
        </h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Exams" subtitle={`${course.exams.length} in this course`} />
            {course.exams.length === 0 ? (
              <Empty>No exams yet.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {course.exams.map((exam) => (
                  <li key={exam.id}>
                    <Link
                      href={`/exams/${exam.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium">{exam.title}</span>
                      <span className="flex items-center gap-2 text-xs text-slate-500">
                        <span>
                          {exam._count.questions} question{exam._count.questions === 1 ? '' : 's'}
                        </span>
                        {exam._count.runs > 0 ? (
                          <Badge tone="blue">
                            {exam._count.runs} run{exam._count.runs === 1 ? '' : 's'}
                          </Badge>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Roster"
              subtitle={
                lastImport
                  ? `${course.students.length} students · last imported ${lastImport.filename} on ${lastImport.createdAt.toLocaleDateString()}`
                  : 'No roster imported yet'
              }
            />
            {canvas ? (
              <div className="border-b border-slate-100">
                <p className="px-5 pt-4 text-xs font-medium text-slate-600">Sync from Canvas</p>
                <CanvasSync
                  courseId={course.id}
                  courses={canvas.courses}
                  linkedCanvasCourseId={course.canvasCourseId}
                  loadError={canvas.error}
                />
              </div>
            ) : null}

            {canvas ? (
              <p className="px-5 pt-4 text-xs font-medium text-slate-600">Or import a CSV</p>
            ) : null}
            <RosterUpload courseId={course.id} />

            {sections.size > 0 ? (
              <div className="border-t border-slate-100 px-5 py-3">
                <p className="mb-2 text-xs font-medium text-slate-600">Sections</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...sections]
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([code, count]) => (
                      <Badge key={code}>
                        {sectionLabel(code)} · {count}
                      </Badge>
                    ))}
                </div>
              </div>
            ) : null}

            {course.students.length > 0 ? (
              <details className="border-t border-slate-100">
                <summary className="cursor-pointer px-5 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                  View all {course.students.length} students
                </summary>
                <div className="max-h-96 overflow-y-auto border-t border-slate-100">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-50">
                      {course.students.map((student) => (
                        <tr key={student.id}>
                          <td className="px-5 py-1.5">
                            {student.lastName}, {student.firstName}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs text-slate-500">
                            {student.gtId ?? student.username ?? "—"}
                          </td>
                          <td className="px-5 py-1.5 text-right text-xs text-slate-400">
                            {(JSON.parse(student.sections) as string[]).map(sectionLabel).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
        <Card className="h-fit p-5">
          <h2 className="mb-3 text-sm font-semibold">New exam</h2>
          <form action={createExam} className="space-y-3">
            <input type="hidden" name="courseId" value={course.id} />
            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" placeholder="Exam 1" required />
            </div>
            <Button type="submit" className="w-full">
              Create exam
            </Button>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            A random instructor seed is assigned automatically; you can change it on the exam page.
          </p>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold text-red-800">Delete course</h2>
          <p className="mb-3 text-xs text-slate-500">
            Removes this course and everything under it.
          </p>
          <DangerZone
            action={deleteCourse}
            hiddenFields={{ courseId: course.id }}
            label="Delete this course"
            description={`This permanently deletes ${course.name}: ${course.students.length} students, ${course.exams.length} exam(s), every generation run and grade, and all generated PDFs. This cannot be undone.`}
            confirmHint="To confirm, type the course name:"
            confirmWord={course.name}
            buttonText="Delete course permanently"
          />
        </Card>
        </div>
      </div>
    </div>
  )
}
