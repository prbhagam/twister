import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { PRINT_FILE, runDir } from '@/lib/generation'
import { authorizeRunApi } from '@/lib/authorization'

/** Streams the merged print file; it can be ~90 MB for a full class. */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  if (!await authorizeRunApi(runId, 'exam:generate')) return new Response('Not found', { status: 404 })
  const file = path.join(runDir(runId), PRINT_FILE)

  let size: number
  try {
    size = (await stat(file)).size
  } catch {
    return new Response('Print file not generated yet.', { status: 404 })
  }

  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>
  return new Response(stream, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(size),
      'content-disposition': `attachment; filename="print-all-${runId}.pdf"`,
    },
  })
}
