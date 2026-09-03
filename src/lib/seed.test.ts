import { describe, expect, it } from 'vitest'
import {
  buildLayout,
  distinctExamCount,
  formatBig,
  sfc32,
  shuffle,
  studentSeed,
  type SeedQuestion,
} from './seed'

function makeQuestion(key: string, variationCount = 3, choiceCount = 5, pinLast = false): SeedQuestion {
  return {
    key,
    refId: `run-${key}`,
    points: 1,
    variations: Array.from({ length: variationCount }, (_, v) => ({
      refId: `run-${key}-v${v}`,
      choices: Array.from({ length: choiceCount }, (_, c) => ({
        refId: `run-${key}-v${v}-c${c}`,
        isCorrect: c === 0,
        pinToLast: pinLast && c === choiceCount - 1,
      })),
    })),
  }
}

const EXAM = 'exam-1'
const SEED = 'instructor-seed-2026'
const QUESTIONS = Array.from({ length: 12 }, (_, i) => makeQuestion(`q${i + 1}`))

describe('determinism', () => {
  it('produces an identical layout for the same seed, exam, and student', () => {
    const a = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000101', questions: QUESTIONS })
    const b = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000101', questions: QUESTIONS })
    expect(a).toEqual(b)
  })

  it('tolerates whitespace and non-string GT IDs from CSV parsing', () => {
    const a = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000101', questions: QUESTIONS })
    const b = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: ' 903000101 ', questions: QUESTIONS })
    expect(a.traceCode).toBe(b.traceCode)
  })

  it('gives different students different papers', () => {
    const a = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000101', questions: QUESTIONS })
    const b = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000102', questions: QUESTIONS })
    expect(a.entries).not.toEqual(b.entries)
    expect(a.traceCode).not.toBe(b.traceCode)
  })

  it('changes every paper when the instructor seed changes', () => {
    const a = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000101', questions: QUESTIONS })
    const b = buildLayout({ instructorSeed: 'different', examId: EXAM, gtId: '903000101', questions: QUESTIONS })
    expect(a.entries).not.toEqual(b.entries)
  })

  it('isolates questions from each other: editing q7 leaves q1-q6 untouched', () => {
    const before = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000101', questions: QUESTIONS })

    // q7 gains a fourth variation; every other question is unchanged.
    const edited = QUESTIONS.map((q) => (q.key === 'q7' ? makeQuestion('q7', 4) : q))
    const after = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000101', questions: edited })

    const pick = (l: typeof before, key: string) => {
      const e = l.entries.find((x) => x.runQuestionId === `run-${key}`)!
      return { variation: e.runVariationId, choices: e.choiceOrder }
    }

    for (const key of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) {
      expect(pick(after, key)).toEqual(pick(before, key))
    }
  })
})

describe('layout shape', () => {
  const layout = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000101', questions: QUESTIONS })

  it('assigns contiguous 1-based bubble positions', () => {
    expect(layout.entries.map((e) => e.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('includes every question exactly once', () => {
    const ids = layout.entries.map((e) => e.runQuestionId).sort()
    expect(ids).toEqual(QUESTIONS.map((q) => q.refId).sort())
  })

  it('permutes choices without dropping or duplicating any', () => {
    for (const entry of layout.entries) {
      expect(new Set(entry.choiceOrder).size).toBe(entry.choiceOrder.length)
      expect(entry.choiceCount).toBe(entry.choiceOrder.length)
    }
  })

  it('records the correct letter at the position the correct choice actually landed', () => {
    for (const entry of layout.entries) {
      const index = entry.choiceOrder.findIndex((id) => id.endsWith('-c0')) // c0 is the correct one
      expect(entry.correctLetter).toBe(['A', 'B', 'C', 'D', 'E'][index])
    }
  })

  it('actually reorders questions rather than printing author order', () => {
    const authorOrder = QUESTIONS.map((q) => q.refId)
    const printed = layout.entries.map((e) => e.runQuestionId)
    expect(printed).not.toEqual(authorOrder)
  })
})

describe('forcedVariantIndex', () => {
  it('picks the given variation on every question instead of drawing randomly', () => {
    const layout = buildLayout({
      instructorSeed: SEED,
      examId: EXAM,
      gtId: 'practice:B',
      questions: QUESTIONS,
      forcedVariantIndex: 1,
    })
    for (const entry of layout.entries) {
      expect(entry.runVariationId.endsWith('-v1')).toBe(true)
    }
  })

  it('still shuffles choices and question order, reproducibly', () => {
    const a = buildLayout({
      instructorSeed: SEED,
      examId: EXAM,
      gtId: 'practice:A',
      questions: QUESTIONS,
      forcedVariantIndex: 0,
    })
    const b = buildLayout({
      instructorSeed: SEED,
      examId: EXAM,
      gtId: 'practice:A',
      questions: QUESTIONS,
      forcedVariantIndex: 0,
    })
    expect(a).toEqual(b)

    const authorOrder = QUESTIONS.map((q) => q.refId)
    expect(a.entries.map((e) => e.runQuestionId)).not.toEqual(authorOrder)
    for (const entry of a.entries) {
      expect(new Set(entry.choiceOrder).size).toBe(entry.choiceOrder.length)
    }
  })

  it('gives different variant indices distinct traces', () => {
    const a = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: 'practice:A', questions: QUESTIONS, forcedVariantIndex: 0 })
    const b = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: 'practice:B', questions: QUESTIONS, forcedVariantIndex: 1 })
    expect(a.traceCode).not.toBe(b.traceCode)
  })
})

describe('pinned choices', () => {
  it('always places a pinned choice last', () => {
    const pinned = Array.from({ length: 12 }, (_, i) => makeQuestion(`p${i + 1}`, 3, 5, true))
    // Sweep many students: a pin that only usually holds is a bug that ships.
    for (let i = 0; i < 500; i++) {
      const layout = buildLayout({
        instructorSeed: SEED,
        examId: EXAM,
        gtId: `9040000${String(i).padStart(3, '0')}`,
        questions: pinned,
      })
      for (const entry of layout.entries) {
        expect(entry.choiceOrder.at(-1)).toMatch(/-c4$/)
      }
    }
  })
})

describe('short variations', () => {
  it('supports 2-5 choices and reports the count for out-of-range grading', () => {
    const short = [makeQuestion('s1', 1, 3), makeQuestion('s2', 1, 5)]
    const layout = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId: '903000101', questions: short })
    const byQuestion = new Map(layout.entries.map((e) => [e.runQuestionId, e]))
    expect(byQuestion.get('run-s1')!.choiceCount).toBe(3)
    expect(byQuestion.get('run-s2')!.choiceCount).toBe(5)
    // A 3-choice question can never key to D or E.
    expect(['A', 'B', 'C']).toContain(byQuestion.get('run-s1')!.correctLetter)
  })
})

describe('uniqueness across a real-sized roster', () => {
  it('gives all 404 students distinct papers', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 404; i++) {
      const gtId = String(903970000 + i * 7)
      const layout = buildLayout({ instructorSeed: SEED, examId: EXAM, gtId, questions: QUESTIONS })
      seen.add(JSON.stringify(layout.entries))
    }
    expect(seen.size).toBe(404)
  })

  it('distributes variation picks roughly uniformly', () => {
    const counts = new Map<string, number>()
    const n = 3000
    for (let i = 0; i < n; i++) {
      const layout = buildLayout({
        instructorSeed: SEED,
        examId: EXAM,
        gtId: String(903970000 + i),
        questions: QUESTIONS,
      })
      const entry = layout.entries.find((e) => e.runQuestionId === 'run-q1')!
      counts.set(entry.runVariationId, (counts.get(entry.runVariationId) ?? 0) + 1)
    }
    expect(counts.size).toBe(3)
    // Expected n/3 = 1000 each; allow generous slack for a fair coin.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(n / 3 - 120)
      expect(count).toBeLessThan(n / 3 + 120)
    }
  })
})

describe('prng', () => {
  it('stays in [0, 1)', () => {
    const rng = sfc32(studentSeed('k', 'e', 's'))
    for (let i = 0; i < 10_000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('shuffle is a true permutation', () => {
    const rng = sfc32(studentSeed('k', 'e', 's'))
    const items = Array.from({ length: 20 }, (_, i) => i)
    const out = shuffle(items, rng)
    expect(out.slice().sort((a, b) => a - b)).toEqual(items)
  })
})

describe('distinctExamCount', () => {
  it('matches the hand calculation for 12 questions x 3 variations x 5 choices', () => {
    // 12 questions, each 3 variations x 5! orders = 360, then 12! question orders.
    const expected = 360n ** 12n * 479001600n
    expect(distinctExamCount(QUESTIONS)).toBe(expected)
    expect(formatBig(expected)).toBe('2.26 × 10^39')
  })

  it('discounts pinned choices, which do not permute', () => {
    const pinned = [makeQuestion('p1', 1, 5, true)]
    // 1 variation x 4! orders x 1! question order
    expect(distinctExamCount(pinned)).toBe(24n)
  })

  it('is zero for an empty exam', () => {
    expect(distinctExamCount([])).toBe(0n)
  })
})
