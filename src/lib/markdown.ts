import rehypeShiki from '@shikijs/rehype'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

/**
 * One pipeline, used by both the editor preview and the PDF renderer, so what you
 * see while authoring is what lands on the printed page.
 *
 * Input is trusted: the only author is the authenticated instructor, and output is
 * consumed by their own browser and by headless Chromium. There is no untrusted
 * markdown path in this system.
 */
function build() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeShiki, {
      // Light theme only: these end up on paper.
      theme: 'github-light',
      fallbackLanguage: 'text',
    })
    // rehype-katex never throws on bad LaTeX — it renders the error inline, which
    // is what we want: one malformed formula must not abort a 404-student run.
    .use(rehypeKatex, { output: 'html' })
    .use(rehypeStringify)
}

// Shiki loads grammars and themes on first use (tens of ms); reusing the processor
// keeps a 400-student run from paying that repeatedly.
let processor: ReturnType<typeof build> | null = null

export async function renderMarkdown(markdown: string): Promise<string> {
  if (!markdown.trim()) return ''
  processor ??= build()
  const file = await processor.process(markdown)
  return String(file)
}

/** Renders many snippets concurrently — used once per generation run. */
export async function renderAll(markdowns: string[]): Promise<string[]> {
  return Promise.all(markdowns.map(renderMarkdown))
}

/** Strips markdown to a short single line, for list views and CSV columns. */
export function toPlainSummary(markdown: string, max = 90): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [image] ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
