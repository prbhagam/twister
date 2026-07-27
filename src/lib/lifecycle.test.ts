import { describe, expect, it } from 'vitest'
import { canTransitionExam } from './lifecycle'

describe('exam lifecycle', () => {
  it('permits the reviewed generation path', () => {
    expect(canTransitionExam('DRAFT', 'READY_FOR_REVIEW')).toBe(true)
    expect(canTransitionExam('READY_FOR_REVIEW', 'APPROVED')).toBe(true)
    expect(canTransitionExam('APPROVED', 'GENERATED')).toBe(true)
    expect(canTransitionExam('GENERATED', 'LOCKED')).toBe(true)
  })
  it('rejects skipping review or editing through a lock', () => {
    expect(canTransitionExam('DRAFT', 'GENERATED')).toBe(false)
    expect(canTransitionExam('LOCKED', 'DRAFT')).toBe(false)
  })
})
