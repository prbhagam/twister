import Link from 'next/link'
import { prisma } from '@/lib/db'
import { Button, Card, CardHeader, Empty, Input, Label } from '@/components/ui'
import { createCourse } from './actions'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { exams: true, students: true } },
      exams: { orderBy: { updatedAt: 'desc' }, take: 4 },
    },
  })

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <h1 className="text-lg font-semibold">Courses</h1>

        {courses.length === 0 ? (
          <Card>
            <Empty>No courses yet. Create one to get started.</Empty>
          </Card>
        ) : (
          courses.map((course) => (
            <Card key={course.id}>
              <CardHeader
                title={
                  <Link href={`/courses/${course.id}`} className="hover:underline">
                    {course.name}
                    {course.title ? <span className="font-normal text-slate-500"> — {course.title}</span> : null}
                  </Link>
                }
                subtitle={`${course._count.students} students · ${course._count.exams} exam${course._count.exams === 1 ? '' : 's'}${course.term ? ` · ${course.term}` : ''}`}
              />
              {course.exams.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {course.exams.map((exam) => (
                    <li key={exam.id}>
                      <Link
                        href={`/exams/${exam.id}`}
                        className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-slate-50"
                      >
                        <span>{exam.title}</span>
                        <span className="text-xs text-slate-400">
                          edited {exam.updatedAt.toLocaleDateString()}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No exams in this course yet.</Empty>
              )}
            </Card>
          ))
        )}
      </div>

      <Card className="h-fit p-5">
        <h2 className="mb-3 text-sm font-semibold">New course</h2>
        <form action={createCourse} className="space-y-3">
          <div>
            <Label htmlFor="name">Course number</Label>
            <Input id="name" name="name" placeholder="CS 1301" required />
          </div>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Introduction to Computing" />
          </div>
          <div>
            <Label htmlFor="term">Term</Label>
            <Input id="term" name="term" placeholder="Summer 2026" />
          </div>
          <Button type="submit" className="w-full">
            Create course
          </Button>
        </form>
      </Card>
    </div>
  )
}
