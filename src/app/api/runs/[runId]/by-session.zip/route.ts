import { Readable } from 'node:stream'
import type { Archiver } from 'archiver'
import { audit } from '@/lib/audit'
import { authorizeRunApi } from '@/lib/authorization'
import { streamRunBySessionZip } from '@/lib/signup-export'

/**
 * Streams a ZIP of this run's already-generated PDFs, grouped into folders by
 * each student's current signup bucket (session / exception / not signed up).
 * Serves the same PDFs `print.pdf` serves — no grade data — so it is gated the
 * same way, not behind the grading-specific `export:grades` permission.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  const authed = await authorizeRunApi(runId, 'exam:generate')
  if (!authed) return new Response('Not found', { status: 404 })

  let archive: Archiver
  let entryCount: number
  try {
    ;({ archive, entryCount } = await streamRunBySessionZip(runId))
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Export failed.', { status: 409 })
  }
  if (entryCount === 0) return new Response('Nothing generated for this run yet.', { status: 409 })

  await audit({
    actorUserId: authed.user.id,
    action: 'run.by_session_exported',
    entityType: 'generation_run',
    entityId: runId,
    courseId: authed.run.exam.courseId,
    metadata: { entryCount },
  })

  // No content-length: the archive is produced as it is sent.
  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="by-session-${runId}.zip"`,
      'cache-control': 'no-store',
    },
  })
}
