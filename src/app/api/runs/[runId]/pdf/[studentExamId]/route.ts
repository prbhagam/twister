import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { runDir } from '@/lib/generation'

/** Serves one student's exam PDF, for the review UI's inline viewer. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; studentExamId: string }> },
) {
  const { runId, studentExamId } = await params

  const studentExam = await prisma.studentExam.findUnique({ where: { id: studentExamId } })
  if (!studentExam || studentExam.runId !== runId || !studentExam.pdfPath) {
    return new Response('Not found', { status: 404 })
  }

  // pdfPath is a bare filename written by the generator; resolve and confirm it
  // stays inside the run directory rather than trusting it as a path.
  const dir = runDir(runId)
  const file = path.resolve(dir, path.basename(studentExam.pdfPath))
  if (!file.startsWith(path.resolve(dir) + path.sep)) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const bytes = await readFile(file)
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="${path.basename(file)}"`,
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
