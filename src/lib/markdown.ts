import rehypeShiki from '@shikijs/rehype'
import rehypeKatex from 'rehype-katex'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { CODE_VAR_PREFIX, PRINT_CODE_THEME, SCREEN_CODE_THEME } from './print-theme'

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
      // Both palettes, on every token, as CSS custom properties.
      //
      // One render has to serve two audiences that want opposite things. The
      // printed booklet needs grayscale, distinguished by weight rather than hue,
      // because a colour theme's tokens all flatten to the same grey on a laser
      // printer. The graded report, question bank, and review UI are read on
      // screen and want the colour. And the render is shared whether we like it or
      // not: createRun freezes this HTML into the run snapshot, and the booklet and
      // the report both read that one frozen copy.
      //
      // So neither palette is baked in. Each document selects one with
      // `codeThemeCss`, and a document that forgets gets flat, uncoloured code.
      themes: { screen: SCREEN_CODE_THEME, print: PRINT_CODE_THEME },
      defaultColor: false,
      cssVariablePrefix: CODE_VAR_PREFIX,
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
