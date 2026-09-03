import { MAX_CHOICES } from './seed'

export interface ValidationIssue {
  level: 'error' | 'warning'
  questionId?: string
  variationId?: string
  message: string
}

export interface ValidatableExam {
  instructorSeed: string
  isPracticeExam?: boolean
  questions: {
    id: string
    order: number
    points: number
    variations: {
      id: string
      label: string
      promptMarkdown: string
      choices: { id: string; textMarkdown: string; isCorrect: boolean; pinToLast: boolean }[]
    }[]
  }[]
}

/**
 * Pre-flight checks run before a generation run is allowed to start.
 *
 * Errors block generation; warnings are shown but do not. The distinction matters:
 * a question with no correct answer flagged would print fine and then be ungradable
 * for all 404 students, whereas a 4-choice question is a deliberate, supported
 * choice that merely deserves a heads-up.
 */
export function validateExam(exam: ValidatableExam): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  if (!exam.instructorSeed.trim()) {
    issues.push({ level: 'error', message: 'The exam has no instructor seed. Set one before generating.' })
  }

  if (exam.questions.length === 0) {
    issues.push({ level: 'error', message: 'The exam has no questions.' })
    return issues
  }

  for (const question of exam.questions) {
    const where = `Question ${question.order}`

    if (question.variations.length === 0) {
      issues.push({ level: 'error', questionId: question.id, message: `${where} has no variations.` })
      continue
    }
    if (question.variations.length === 1) {
      issues.push({
        level: 'warning',
        questionId: question.id,
        message: `${where} has only one variation, so every student sees the same prompt for it (choices are still shuffled).`,
      })
    }
    if (question.points <= 0) {
      issues.push({
        level: 'warning',
        questionId: question.id,
        message: `${where} is worth ${question.points} points.`,
      })
    }

    for (const variation of question.variations) {
      const label = `${where}, variation ${variation.label}`

      if (!variation.promptMarkdown.trim()) {
        issues.push({
          level: 'error',
          questionId: question.id,
          variationId: variation.id,
          message: `${label} has an empty prompt.`,
        })
      }

      const choices = variation.choices
      if (choices.length < 2) {
        issues.push({
          level: 'error',
          questionId: question.id,
          variationId: variation.id,
          message: `${label} has ${choices.length} choice(s); at least 2 are required.`,
        })
      } else if (choices.length > MAX_CHOICES) {
        issues.push({
          level: 'error',
          questionId: question.id,
          variationId: variation.id,
          message: `${label} has ${choices.length} choices, but the Gradescope sheet only offers ${MAX_CHOICES} (A-E).`,
        })
      } else if (choices.length < MAX_CHOICES) {
        issues.push({
          level: 'warning',
          questionId: question.id,
          variationId: variation.id,
          message: `${label} has only ${choices.length} choices. The scantron still offers A-E, so a student bubbling past ${String.fromCharCode(64 + choices.length)} scores 0 and is flagged for review.`,
        })
      }

      if (choices.some((c) => !c.textMarkdown.trim())) {
        issues.push({
          level: 'error',
          questionId: question.id,
          variationId: variation.id,
          message: `${label} has an empty answer choice.`,
        })
      }

      const correct = choices.filter((c) => c.isCorrect).length
      if (correct === 0) {
        issues.push({
          level: 'error',
          questionId: question.id,
          variationId: variation.id,
          message: `${label} has no correct answer marked — it would be ungradable.`,
        })
      } else if (correct > 1) {
        issues.push({
          level: 'error',
          questionId: question.id,
          variationId: variation.id,
          message: `${label} has ${correct} correct answers marked; exactly one is required.`,
        })
      }

      if (choices.length > 0 && choices.every((c) => c.pinToLast)) {
        issues.push({
          level: 'error',
          questionId: question.id,
          variationId: variation.id,
          message: `${label} has every choice pinned to last, so nothing would shuffle.`,
        })
      }
    }

    // Uneven variation counts are legal but skew which students see which prompt.
    const choiceCounts = new Set(question.variations.map((v) => v.choices.length))
    if (choiceCounts.size > 1) {
      issues.push({
        level: 'warning',
        questionId: question.id,
        message: `${where}'s variations have differing choice counts (${[...choiceCounts].sort().join(', ')}), so some students get more options than others.`,
      })
    }
  }

  // A practice exam has no per-student roster to average over: "variant A" must mean
  // the same slot on every question, which only holds if every question offers the
  // same number of variations.
  if (exam.isPracticeExam) {
    const counts = new Set(exam.questions.map((q) => q.variations.length))
    if (counts.size > 1) {
      issues.push({
        level: 'error',
        message:
          `Practice exams need every question to have the same number of variations ` +
          `(found ${[...counts].sort((a, b) => a - b).join(', ')}). Add or remove variations so they match.`,
      })
    }
  }

  return issues
}

export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error')
}
