import { describe, expect, it } from 'vitest'
import { buildExamBody, type RenderExam } from './exam-html'

const exam: RenderExam = {
  examTitle: 'In-Person Exam 1',
  courseName: 'CS 1301',
  studentName: 'Nadia Abbott',
  gtId: '903000101',
  traceCode: 'ABC123',
  questions: [],
  katexHref: null,
}

/** Just the cover section, so a match can't come from a question body. */
function cover(html: string): string {
  return html.slice(html.indexOf('<section class="cover">'), html.indexOf('</section>') + '</section>'.length)
}

describe('the cover’s version name', () => {
  it('prints under the title, exactly as written', () => {
    const html = cover(buildExamBody({ ...exam, versionName: 'Version We Were on a Break' }))
    expect(html).toContain('<p class="version">Version We Were on a Break</p>')
    expect(html.indexOf('class="version"')).toBeGreaterThan(html.indexOf('<h1>'))
    expect(html.indexOf('class="version"')).toBeLessThan(html.indexOf('class="course"'))
  })

  it('is escaped, since the text comes straight from a CSV', () => {
    const html = cover(buildExamBody({ ...exam, versionName: 'Version <Joey> & "Chandler"' }))
    expect(html).toContain('Version &lt;Joey&gt; &amp;')
    expect(html).not.toContain('<Joey>')
  })

  it('leaves no trace when the exam has no version names', () => {
    expect(cover(buildExamBody(exam))).not.toContain('class="version"')
  })
})
