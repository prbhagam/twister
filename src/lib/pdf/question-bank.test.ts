import { describe, expect, it } from 'vitest'
import { bankTotals, buildBankBody, type QuestionBank } from './question-bank'

const bank: QuestionBank = {
  courseName: 'CS 1301 — Introduction to Computing',
  examTitle: 'Exam 1',
  generatedOn: '2026-09-03',
  questions: [
    {
      order: 1,
      title: 'Loop tracing',
      points: 2,
      status: 'APPROVED',
      allowMultipleCorrect: false,
      variations: [
        {
          label: 'A',
          promptHtml: '<p>What does <code>range(3)</code> yield?</p>',
          choices: [
            { number: 1, html: '<p>0, 1, 2</p>', correct: true, pinToLast: false },
            { number: 2, html: '<p>1, 2, 3</p>', correct: false, pinToLast: false },
            { number: 3, html: '<p>None of the above</p>', correct: false, pinToLast: true },
          ],
        },
        {
          label: 'B',
          promptHtml: '<p>What does <code>range(4)</code> yield?</p>',
          choices: [
            { number: 1, html: '<p>0, 1, 2, 3</p>', correct: true, pinToLast: false },
            { number: 2, html: '<p>1, 2, 3, 4</p>', correct: false, pinToLast: false },
          ],
        },
      ],
    },
    {
      order: 2,
      title: null,
      points: 1,
      status: 'DRAFT',
      allowMultipleCorrect: false,
      variations: [
        {
          label: 'A',
          promptHtml: '',
          choices: [{ number: 1, html: '<p>x</p>', correct: false, pinToLast: false }],
        },
      ],
    },
  ],
}

describe('bankTotals', () => {
  it('counts questions, variations, and total points', () => {
    expect(bankTotals(bank)).toEqual({ questions: 2, variations: 3, points: 3 })
  })
})

describe('buildBankBody', () => {
  const html = buildBankBody(bank)

  it('labels every question with its number, points, and workflow status', () => {
    expect(html).toContain('Question 1')
    expect(html).toContain('Question 2')
    expect(html).toContain('2 pts')
    expect(html).toContain('1 pt')
    expect(html).toContain('>approved<')
    expect(html).toContain('>draft<')
  })

  it('labels every variation and includes each one in full', () => {
    expect(html).toContain('Variation A')
    expect(html).toContain('Variation B')
    expect(html).toContain('range(3)')
    expect(html).toContain('range(4)')
  })

  it('marks the correct choice and the pinned one', () => {
    expect(html).toContain('&#10003; correct')
    expect(html).toContain('pinned last')
  })

  it('numbers choices rather than lettering them', () => {
    // The letters on a student's paper come from that student's shuffle. Printing
    // "A" here would read as an answer key that is wrong for every student.
    expect(html).toContain('<span class="num">1.</span>')
    expect(html).not.toMatch(/<span class="num">A\.<\/span>/)
  })

  it('says it holds the answers, so it is not mistaken for a handout', () => {
    expect(html).toContain('Correct answers are marked')
    expect(html).toContain('Do not hand this out')
  })

  it('flags a variation with no correct answer instead of quietly printing it', () => {
    expect(html).toContain('no correct answer')
  })

  it('shows an empty prompt as a problem rather than as blank space', () => {
    expect(html).toContain('Empty prompt.')
  })

  it('escapes text that comes from the instructor', () => {
    const injected = buildBankBody({ ...bank, examTitle: '<script>alert(1)</script>' })
    expect(injected).not.toContain('<script>')
    expect(injected).toContain('&lt;script&gt;')
  })

  it('renders an exam with no questions without throwing', () => {
    expect(buildBankBody({ ...bank, questions: [] })).toContain('no questions yet')
  })
})

describe('buildBankBody select-all-that-apply', () => {
  const satBank: QuestionBank = {
    ...bank,
    questions: [
      {
        order: 1,
        title: 'Truthiness',
        points: 1,
        status: 'APPROVED',
        allowMultipleCorrect: true,
        variations: [
          {
            label: 'A',
            promptHtml: '<p>Which are truthy?</p>',
            choices: [
              { number: 1, html: '<p>1</p>', correct: true, pinToLast: false },
              { number: 2, html: '<p>0</p>', correct: false, pinToLast: false },
              { number: 3, html: "<p>'a'</p>", correct: true, pinToLast: false },
            ],
          },
        ],
      },
    ],
  }
  const html = buildBankBody(satBank)

  it('labels the question as select-all-that-apply', () => {
    expect(html).toContain('select all that apply')
  })

  it('marks two correct choices without a warning tag', () => {
    expect(html).toContain('2 correct answers')
    expect(html).toContain('class="tag ok">2 correct answers')
    expect(html).not.toContain('class="tag warn">2 correct answers')
  })

  it('still warns when a select-all-that-apply variation has no correct answer', () => {
    const noneCorrect = {
      ...satBank,
      questions: [
        {
          ...satBank.questions[0],
          variations: satBank.questions[0].variations.map((v) => ({
            ...v,
            choices: v.choices.map((c) => ({ ...c, correct: false })),
          })),
        },
      ],
    }
    expect(buildBankBody(noneCorrect)).toContain('no correct answer')
  })
})
