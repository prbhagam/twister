import { Badge, Button, Card, CardHeader } from '@/components/ui'
import { DangerZone } from '@/components/DangerZone'
import { purgeCourse, restoreCourse } from './actions'

export interface ArchivedCourse {
  id: string
  name: string
  title: string | null
  archivedAt: Date | null
  students: number
  exams: number
  runs: number
}

/**
 * Archived courses, which the dashboard otherwise filters out entirely.
 *
 * Without this they are invisible and unreachable: the delete button on a course
 * archives rather than destroys, so a course "deleted" by mistake has no way back,
 * and one archived on purpose keeps its roster indefinitely with nothing to say so.
 */
export function ArchivedCourses({
  courses,
  canPurge,
}: {
  courses: ArchivedCourse[]
  canPurge: boolean
}) {
  if (courses.length === 0) return null

  const students = courses.reduce((n, c) => n + c.students, 0)

  return (
    <Card>
      <CardHeader
        title="Archived courses"
        subtitle={`${courses.length} course${courses.length === 1 ? '' : 's'} · ${students} student record${students === 1 ? '' : 's'} still stored`}
      />
      <ul className="divide-y divide-slate-100">
        {courses.map((course) => (
          <li key={course.id} className="px-5 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-700">
                  {course.name}
                  {course.title ? (
                    <span className="font-normal text-slate-500"> — {course.title}</span>
                  ) : null}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge>{course.students} students</Badge>
                  <Badge>
                    {course.exams} exam{course.exams === 1 ? '' : 's'}
                  </Badge>
                  {course.runs > 0 ? (
                    <Badge>
                      {course.runs} run{course.runs === 1 ? '' : 's'}
                    </Badge>
                  ) : null}
                  {course.archivedAt ? (
                    <span className="text-xs text-slate-400">
                      archived {course.archivedAt.toLocaleDateString()}
                    </span>
                  ) : null}
                </div>
              </div>

              <form action={restoreCourse}>
                <input type="hidden" name="courseId" value={course.id} />
                <Button type="submit" variant="secondary">
                  Restore
                </Button>
              </form>
            </div>

            {canPurge ? (
              <div className="mt-2">
                <DangerZone
                  action={purgeCourse}
                  hiddenFields={{ courseId: course.id }}
                  label="Delete permanently"
                  description={`This destroys ${course.name} for good: ${course.students} student record(s), ${course.exams} exam(s), ${course.runs} generation run(s) with their grades, and the generated PDFs on disk. Archiving can be undone; this cannot.`}
                  confirmHint="To confirm, type the course name:"
                  confirmWord={course.name}
                  buttonText="Delete permanently"
                />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}
