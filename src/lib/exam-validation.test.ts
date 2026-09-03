import { describe, expect, it } from 'vitest'
import { hasBlockingErrors, validateExam, type ValidatableExam } from './exam-validation'

function makeVariation(label: string, choiceCount = 5) {
  return {
    id: `v-${label}`,
    label,
    promptMarkdown: `Prompt ${label}`,
    choices: Array.from({ length: choiceCount }, (_, i) => ({
      id: `v-${label}-c${i}`,
      textMarkdown: `Choice ${i}`,
      isCorrect: i === 0,
      pinToLast: false,
    })),
  }
}

function makeExam(variationCounts: number[], isPracticeExam = false): ValidatableExam {
  return {
    instructorSeed: 'seed',
    isPracticeExam,
    questions: variationCounts.map((count, i) => ({
      id: `q${i + 1}`,
      order: i + 1,
      points: 1,
      variations: Array.from({ length: count }, (_, v) => makeVariation(String.fromCharCode(65 + v))),
    })),
  }
}

describe('practice exam validation', () => {
  it('does not block a normal exam with uneven variation counts', () => {
    const issues = validateExam(makeExam([2, 3, 3], false))
    expect(hasBlockingErrors(issues)).toBe(false)
  })

  it('blocks a practice exam with uneven variation counts', () => {
    const issues = validateExam(makeExam([2, 3, 3], true))
    expect(hasBlockingErrors(issues)).toBe(true)
    expect(issues.some((i) => i.message.includes('same number of variations'))).toBe(true)
  })

  it('allows a practice exam once every question has the same count', () => {
    const issues = validateExam(makeExam([3, 3, 3], true))
    expect(hasBlockingErrors(issues)).toBe(false)
  })
})
