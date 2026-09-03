import { describe, expect, it } from 'vitest'
import { hasBlockingErrors, validateExam, type ValidatableExam } from './exam-validation'

function makeVariation(label: string, correctIndices: number[], choiceCount = 5) {
  return {
    id: `v-${label}`,
    label,
    promptMarkdown: `Prompt ${label}`,
    choices: Array.from({ length: choiceCount }, (_, i) => ({
      id: `v-${label}-c${i}`,
      textMarkdown: `Choice ${i}`,
      isCorrect: correctIndices.includes(i),
      pinToLast: false,
    })),
  }
}

function makeExam(
  variationCounts: number[],
  isPracticeExam = false,
  allowMultipleCorrect = false,
  correctIndices: number[] = [0],
): ValidatableExam {
  return {
    instructorSeed: 'seed',
    isPracticeExam,
    questions: variationCounts.map((count, i) => ({
      id: `q${i + 1}`,
      order: i + 1,
      points: 1,
      allowMultipleCorrect,
      variations: Array.from({ length: count }, (_, v) => makeVariation(String.fromCharCode(65 + v), correctIndices)),
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

describe('select-all-that-apply validation', () => {
  it('blocks an ordinary question with two correct answers marked', () => {
    const issues = validateExam(makeExam([3], false, false, [0, 1]))
    expect(hasBlockingErrors(issues)).toBe(true)
    expect(issues.some((i) => i.message.includes('does not allow multiple correct answers'))).toBe(true)
  })

  it('allows multiple correct answers once the question opts in', () => {
    const issues = validateExam(makeExam([3], false, true, [0, 1]))
    expect(hasBlockingErrors(issues)).toBe(false)
  })

  it('still allows exactly one correct answer on a question that opts in', () => {
    const issues = validateExam(makeExam([3], false, true, [0]))
    expect(hasBlockingErrors(issues)).toBe(false)
  })

  it('still blocks zero correct answers even when multiple are allowed', () => {
    const issues = validateExam(makeExam([3], false, true, []))
    expect(hasBlockingErrors(issues)).toBe(true)
    expect(issues.some((i) => i.message.includes('no correct answer'))).toBe(true)
  })
})
