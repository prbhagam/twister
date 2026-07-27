import { NextResponse } from 'next/server'
import { renderMarkdown } from '@/lib/markdown'

/**
 * Live preview for the question editor. Uses the same pipeline as the PDF renderer,
 * so what the editor shows is what prints.
 */
export async function POST(request: Request) {
  const { markdown } = (await request.json()) as { markdown?: string }
  return NextResponse.json({ html: await renderMarkdown(markdown ?? '') })
}
