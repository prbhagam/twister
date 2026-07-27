import { prisma } from '@/lib/db'
import { answerKeyCsv } from '@/lib/export'
import { loadLabelMaps } from '@/lib/run-data'
import type { LayoutEntry } from '@/lib/seed'

/**
 * The per-student answer key. Without this an individualized exam is unauditable:
 * there is no other way to check a disputed score against the paper a student held.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params

  const studentExams = await prisma.studentExam.findMany({
    where: { runId },
    include: { student: true },
  })
  if (studentExams.length === 0) return new Response('Not found', { status: 404 })

  const { questionLabels, variationLabels } = await loadLabelMaps(runId)

  const csv = answerKeyCsv(
    studentExams.map((se) => ({
      student: {
        firstName: se.student.firstName,
        lastName: se.student.lastName,
        gtId: se.student.gtId,
        username: se.student.username,
        email: se.student.email,
        sections: JSON.parse(se.student.sections) as string[],
        traceCode: se.traceCode,
      },
      layout: JSON.parse(se.layout) as LayoutEntry[],
    })),
    questionLabels,
    variationLabels,
  )

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="answer-key-${runId}.csv"`,
    },
  })
}
