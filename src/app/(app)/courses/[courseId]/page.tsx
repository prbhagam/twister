import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { gradedRunsForCourse } from '@/lib/graded-export'
import { sectionLabel } from '@/lib/roster'
import { excludedStudentCount, parseSectionCodes, summarizeSections } from '@/lib/sections'
import { Badge, Button, Card, CardHeader, Empty, Input, Label } from '@/components/ui'
import { DangerZone } from '@/components/DangerZone'
import { createExam, deleteCourse } from '../../actions'
import { RosterUpload } from './RosterUpload'
import { SectionSettings } from './SectionSettings'
import { requireCoursePermission } from '@/lib/authorization'

export const dynamic = 'force-dynamic'

export default async function CoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  await requireCoursePermission(courseId, 'course:view')

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      exams: { where: { archivedAt: null }, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { questions: true, runs: true } } } },
      // Dropped students stay in the database so their graded exams survive, but
      // they are off the roster: excluded from the table and the section counts.
      students: { where: { droppedAt: null }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] },
      rosterImports: { where: { archivedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  if (!course) notFound()

  // Drives the ZIP button: hidden until something in the course is actually graded.
  const gradedRuns = await gradedRunsForCourse(course.id)

  // The delete warning counts dropped students too — deleting the course destroys
  // their rows and graded exams as well, so the roster count would understate it.
  const totalStudents = await prisma.student.count({ where: { courseId: course.id } })

  const excludedSections = parseSectionCodes(course.excludedSections)
  const sections = summarizeSections(course.students, excludedSections)
  const excludedStudents = excludedStudentCount(course.students, excludedSections)
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
            <CardHeader
              title="Exams"
              subtitle={`${course.exams.length} in this course`}
              action={
                gradedRuns.length > 0 ? (
                  <a
                    href={`/api/courses/${course.id}/graded-exams.zip`}
                    className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Download graded exams (ZIP)
                  </a>
                ) : null
              }
            />
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
                  ? `${course.students.length} students${excludedStudents ? ` · ${excludedStudents} in excluded sections` : ''} · last imported ${lastImport.filename} on ${lastImport.createdAt.toLocaleDateString()}`
                  : 'No roster imported yet'
              }
            />
            <RosterUpload courseId={course.id} />

            <SectionSettings
              courseId={course.id}
              sections={sections}
              canvasCourseId={course.canvasCourseId}
              excludedStudents={excludedStudents}
            />

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
            description={`This permanently deletes ${course.name}: ${totalStudents} students, ${course.exams.length} exam(s), every generation run and grade, and all generated PDFs. This cannot be undone.`}
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
