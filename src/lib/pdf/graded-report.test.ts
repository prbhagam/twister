import { describe, expect, it } from 'vitest'
import { buildReportBody, type GradedReport, type ReportQuestion } from './graded-report'

function question(overrides: Partial<ReportQuestion> = {}): ReportQuestion {
  return {
    position: 1,
    source: 'Q11B',
    promptHtml: '<p>What does <code>1 &lt; 2</code> evaluate to?</p>',
    choices: [
      { letter: 'A', html: '<p>False</p>', chosen: true, correct: false },
      { letter: 'B', html: '<p>True</p>', chosen: false, correct: true },
      { letter: 'C', html: '<p>Error</p>', chosen: false, correct: false },
    ],
    verdict: 'incorrect',
    verdictLabel: 'Incorrect',
    awarded: 0,
    possible: 1,
    rawResponse: 'A',
    overridden: false,
    ...overrides,
  }
}

function report(overrides: Partial<GradedReport> = {}): GradedReport {
  return {
    courseName: 'CS 1301 — Introduction to Computing',
    examTitle: 'Exam 1',
    studentName: 'Nadia Abbott',
    identifier: '903000101',
    traceCode: 'ABC123',
    score: { earned: 37, possible: 50 },
    questions: [question()],
    ...overrides,
  }
}

describe('buildReportBody', () => {
  it('identifies the student and their score', () => {
    const html = buildReportBody(report())
    expect(html).toContain('Nadia Abbott')
    expect(html).toContain('903000101')
    expect(html).toContain('ABC123')
    expect(html).toContain('37 / 50')
    expect(html).toContain('74.0%')
  })

  it('marks the chosen answer and the correct answer distinctly', () => {
    // The whole point of the document: a student must be able to see what they put
    // and what was right, and the two must not be confusable.
    const html = buildReportBody(report())
    const a = html.slice(html.indexOf('>A.'), html.indexOf('>B.'))
    const b = html.slice(html.indexOf('>B.'), html.indexOf('>C.'))
    expect(a).toContain('marked')
    expect(a).not.toContain('correct</span>')
    expect(b).toContain('correct')
    expect(b).not.toContain('marked')
  })

  it('shows both markers on a question answered correctly', () => {
    const html = buildReportBody(
      report({
        questions: [
          question({
            verdict: 'correct',
            verdictLabel: 'Correct',
            awarded: 1,
            rawResponse: 'B',
            choices: [
              { letter: 'A', html: '<p>False</p>', chosen: false, correct: false },
              { letter: 'B', html: '<p>True</p>', chosen: true, correct: true },
            ],
          }),
        ],
      }),
    )
    const b = html.slice(html.indexOf('>B.'))
    expect(b).toContain('marked')
    expect(b).toContain('correct')
  })

  it('keeps the order the student saw, not the authoring order', () => {
    const html = buildReportBody(
      report({
        questions: [
          question({ position: 1, source: 'Q11B' }),
          question({ position: 2, source: 'Q3A' }),
          question({ position: 3, source: 'Q7C' }),
        ],
      }),
    )
    expect(html.indexOf('Q11B')).toBeLessThan(html.indexOf('Q3A'))
    expect(html.indexOf('Q3A')).toBeLessThan(html.indexOf('Q7C'))
  })

  it('records which authored question each position came from', () => {
    // Needed to find the question in the bank when a student disputes it.
    expect(buildReportBody(report())).toContain('Q11B')
  })

  it('shows what the scanner actually read', () => {
    expect(buildReportBody(report())).toContain('Scanned as')
    expect(buildReportBody(report())).toContain('<code>A</code>')
  })

  it('says "(blank)" rather than nothing when no bubble was filled', () => {
    const html = buildReportBody(
      report({
        questions: [question({ verdict: 'blank', verdictLabel: 'Left blank', rawResponse: '' })],
      }),
    )
    expect(html).toContain('(blank)')
    expect(html).toContain('Left blank')
  })

  it('discloses a hand-set score and its reason', () => {
    const html = buildReportBody(
      report({
        questions: [
          question({ overridden: true, overrideNote: 'scanner missed a faint mark', awarded: 1 }),
        ],
      }),
    )
    expect(html).toContain('score set by hand')
    expect(html).toContain('scanner missed a faint mark')
  })

  it('renders a no-submission report instead of an empty question list', () => {
    const html = buildReportBody(
      report({ score: undefined, questions: [], noSubmission: true }),
    )
    expect(html).toContain('No answer sheet was scanned')
    expect(html).toContain('no submission')
    expect(html).toContain('ABC123')
    expect(html).not.toContain('Scanned as')
  })

  it('escapes student-controlled text rather than injecting it', () => {
    const html = buildReportBody(report({ studentName: 'A <script>alert(1)</script> B' }))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('handles a zero-point exam without dividing by zero', () => {
    const html = buildReportBody(report({ score: { earned: 0, possible: 0 } }))
    expect(html).toContain('0 / 0')
    expect(html).not.toContain('NaN')
  })
})
