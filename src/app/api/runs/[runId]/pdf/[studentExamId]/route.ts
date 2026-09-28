import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { runDir } from '@/lib/generation'
import { authorizeRunApi } from '@/lib/authorization'

/**
 * Serves the PDF of the paper a student actually held, for the review UI's
 * inline viewer: the blank exam they wrote on if they sat a different session,
 * otherwise their own.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string; studentExamId: string }> },
) {
  const { runId, studentExamId } = await params
  if (!await authorizeRunApi(runId, 'grade:view')) return new Response('Not found', { status: 404 })

  const studentExam = await prisma.studentExam.findUnique({
    where: { id: studentExamId },
    include: { blankExam: true },
  })
  const pdfPath = studentExam?.blankExam ? studentExam.blankExam.pdfPath : studentExam?.pdfPath
  if (!studentExam || studentExam.runId !== runId || !pdfPath) {
    return new Response('Not found', { status: 404 })
  }

  // pdfPath is a bare filename written by the generator; resolve and confirm it
  // stays inside the run directory rather than trusting it as a path.
  const dir = runDir(runId)
  const file = path.resolve(dir, path.basename(pdfPath))
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
