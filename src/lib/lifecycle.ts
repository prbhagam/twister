export const EXAM_LIFECYCLES = ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'GENERATED', 'LOCKED', 'GRADED', 'ARCHIVED'] as const
export type ExamLifecycle = (typeof EXAM_LIFECYCLES)[number]

const transitions: Record<ExamLifecycle, readonly ExamLifecycle[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'ARCHIVED'],
  READY_FOR_REVIEW: ['DRAFT', 'APPROVED', 'ARCHIVED'],
  APPROVED: ['DRAFT', 'GENERATED', 'ARCHIVED'],
  GENERATED: ['LOCKED', 'GRADED', 'ARCHIVED'],
  LOCKED: ['GRADED', 'ARCHIVED'],
  GRADED: ['ARCHIVED'],
  ARCHIVED: ['DRAFT'], // explicit restore
}

export function canTransitionExam(from: ExamLifecycle, to: ExamLifecycle) {
  return transitions[from].includes(to)
}
