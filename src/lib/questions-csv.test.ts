import { describe, expect, it } from 'vitest'
import { parseQuestionCsv, toQuestionCsv, WHOLE_EXAM_HEADER } from './questions-csv'

function csv(rows: string[]): string {
  return [WHOLE_EXAM_HEADER.join(','), ...rows].join('\n')
}

// question_number,points,allow_multiple,variation_label,prompt,choice_1,choice_2,choice_3,choice_4,choice_5,correct,pin_last
const ROW_NO_MULTI = '1,1,,A,What is truthy?,1,0,a,,,1 3,'
const ROW_MULTI = '1,1,1,A,What is truthy?,1,0,a,,,1 3,'

describe('parseQuestionCsv — allow_multiple (whole-exam format)', () => {
  it('rejects more than one correct index when allow_multiple is not set', () => {
    const result = parseQuestionCsv(csv([ROW_NO_MULTI]))
    expect(result.errors[0]).toMatch(/does not have.*allow_multiple/)
  })

  it('accepts multiple correct indices once allow_multiple is set on the first row', () => {
    const result = parseQuestionCsv(csv([ROW_MULTI]))
    expect(result.errors).toEqual([])
    expect(result.questions).toHaveLength(1)
    expect(result.questions[0].allowMultipleCorrect).toBe(true)
    expect(result.questions[0].variations[0].choices.map((c) => c.isCorrect)).toEqual([true, false, true])
  })

  it("reads allow_multiple only from the group's first row", () => {
    const result = parseQuestionCsv(
      csv([
        ROW_MULTI,
        // Second row omits allow_multiple entirely; the group already allows it.
        '1,1,,B,What is falsy?,0,1,,,,1 2,',
      ]),
    )
    expect(result.errors).toEqual([])
    expect(result.questions[0].variations).toHaveLength(2)
  })

  it('rejects zero correct indices even when allow_multiple is set', () => {
    const result = parseQuestionCsv(csv(['1,1,1,A,What is truthy?,1,0,a,,,,']))
    expect(result.errors[0]).toMatch(/needs at least one/)
  })

  it('deduplicates a repeated index', () => {
    const result = parseQuestionCsv(csv(['1,1,1,A,What is truthy?,1,0,a,,,1 1,']))
    expect(result.errors).toEqual([])
    expect(result.questions[0].variations[0].choices.filter((c) => c.isCorrect)).toHaveLength(1)
  })
})

describe('parseQuestionCsv — per-question format (no allow_multiple column)', () => {
  const SINGLE_HEADER = 'variation_label,prompt,choice_1,choice_2,choice_3,choice_4,choice_5,correct,pin_last'
  const ROW = 'A,What is truthy?,1,0,a,,,1 3,'

  it('rejects multiple correct indices by default', () => {
    const result = parseQuestionCsv([SINGLE_HEADER, ROW].join('\n'))
    expect(result.errors[0]).toMatch(/does not have.*allow_multiple/)
  })

  it('accepts multiple correct indices when the target question already allows it', () => {
    const result = parseQuestionCsv([SINGLE_HEADER, ROW].join('\n'), { allowMultipleCorrect: true })
    expect(result.errors).toEqual([])
    expect(result.questions[0].variations[0].choices.map((c) => c.isCorrect)).toEqual([true, false, true])
  })
})

describe('toQuestionCsv round-trip', () => {
  it('writes every correct index and the allow_multiple column', () => {
    const out = toQuestionCsv(
      [
        {
          order: 1,
          points: 1,
          allowMultipleCorrect: true,
          variations: [
            {
              label: 'A',
              promptMarkdown: 'What is truthy?',
              choices: [
                { textMarkdown: '1', isCorrect: true, pinToLast: false },
                { textMarkdown: '0', isCorrect: false, pinToLast: false },
                { textMarkdown: 'a', isCorrect: true, pinToLast: false },
              ],
            },
          ],
        },
      ],
      true,
    )

    const reparsed = parseQuestionCsv(out)
    expect(reparsed.errors).toEqual([])
    expect(reparsed.questions[0].allowMultipleCorrect).toBe(true)
    expect(reparsed.questions[0].variations[0].choices.map((c) => c.isCorrect)).toEqual([true, false, true])
  })
})
