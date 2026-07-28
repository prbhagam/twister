import { Readable } from 'node:stream'
import { prisma } from '@/lib/db'
import { requireCoursePermission } from '@/lib/authorization'
import { streamCourseGradedExports } from '@/lib/graded-export'
import { audit } from '@/lib/audit'

/** Streams a ZIP of every graded exam in the course, one folder per student. */
export async function GET(_request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params

  let user
  try {
    user = await requireCoursePermission(courseId, 'export:grades')
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } })
  if (!course || course.archivedAt) return new Response('Not found', { status: 404 })

  let archive
  let total: number
  try {
    ;({ archive, total } = await streamCourseGradedExports(courseId))
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Export failed.', { status: 409 })
  }

  await audit({
    actorUserId: user.id,
    action: 'course.graded_exams_exported',
    entityType: 'course',
    entityId: courseId,
    courseId,
    metadata: { students: total },
  })

  const slug = (course.name || 'course').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '')
  // No content-length: the archive is produced as it is sent.
  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${slug}-graded-exams.zip"`,
      'cache-control': 'no-store',
    },
  })
}
