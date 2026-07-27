import { describe, expect, it } from 'vitest'
import { renderMarkdown, toPlainSummary } from './markdown'

describe('renderMarkdown', () => {
  it('syntax-highlights python, which is most of what CS 1301 asks about', async () => {
    const html = await renderMarkdown('```python\ndef f(xs):\n    return len(xs)\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('shiki')
    // Tokens must be individually colored or the printout is a grey wall of code.
    expect(html).toMatch(/style="color:#[0-9A-Fa-f]{6}"/)
    expect(html).toContain('def')
  })

  it('does not choke on a fenced block with no language', async () => {
    const html = await renderMarkdown('```\n>>> print(1)\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('print(1)')
  })

  it('renders inline code, which shows up in nearly every choice', async () => {
    expect(await renderMarkdown('returns `None`')).toContain('<code>None</code>')
  })

  it('renders GFM tables', async () => {
    const html = await renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  it('renders inline and display math', async () => {
    const html = await renderMarkdown('inline $x^2$ and $$\\frac{1}{2}$$')
    expect(html).toContain('katex')
  })

  it('does not throw on malformed LaTeX, it renders the error inline', async () => {
    // A thrown error mid-run would abort PDF generation for the whole class.
    await expect(renderMarkdown('$\\frac{$')).resolves.toBeTypeOf('string')
  })

  it('returns empty string for blank input', async () => {
    expect(await renderMarkdown('   ')).toBe('')
  })

  it('escapes HTML rather than emitting it raw', async () => {
    expect(await renderMarkdown('a < b and 5 > 3')).toContain('&#x3C;')
  })
})

describe('toPlainSummary', () => {
  it('collapses markdown to a scannable line', () => {
    expect(toPlainSummary('What does `len([1,2,3])` return?')).toBe('What does len([1,2,3]) return?')
  })

  it('replaces code blocks with a placeholder', () => {
    expect(toPlainSummary('Trace this:\n```py\nx = 1\n```')).toBe('Trace this: [code]')
  })

  it('truncates long prompts', () => {
    expect(toPlainSummary('x'.repeat(200), 20)).toHaveLength(20)
  })
})
