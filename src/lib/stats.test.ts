import { describe, expect, it } from 'vitest'
import { LETTERS } from './seed'
import {
  chiSquareUpper,
  computeExamStats,
  cronbachAlpha,
  gradeBands,
  histogram,
  normalTwoSided,
  pearson,
  summarize,
  tTwoSided,
  welchP,
  type StatsInput,
  type StatsQuestion,
  type StatsResponse,
  type StatsStudent,
} from './stats'

describe('descriptive statistics', () => {
  it('summarizes a known sample', () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])!
    expect(s.n).toBe(8)
    expect(s.mean).toBe(5)
    expect(s.sd).toBeCloseTo(2.138, 3)
    expect(s.median).toBe(4.5)
    expect(s.min).toBe(2)
    expect(s.max).toBe(9)
    expect(s.q1).toBe(4)
    expect(s.q3).toBeCloseTo(5.5, 6)
  })

  it('returns null for an empty sample', () => {
    expect(summarize([])).toBeNull()
  })

  it('computes Pearson correlation and refuses a constant side', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 10)
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 10)
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull()
  })

  it('bins on whole points so no bin holds more possible scores than another', () => {
    const bins = histogram([0, 1, 1, 10, 10, 10], 10)
    expect(bins).toHaveLength(11)
    expect(bins.map((b) => b.count)).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 3])
    // A bonus point past the total gets its own bar rather than vanishing.
    expect(histogram([11], 10)).toHaveLength(12)
    // Wide exams widen the bins instead of drawing hundreds of bars.
    expect(histogram([0, 199], 200).length).toBeLessThanOrEqual(50)
  })

  it('counts grade bands with the A band open at the top for bonus scores', () => {
    const bands = gradeBands([100, 102.5, 90, 89.9, 60, 59.9])
    expect(Object.fromEntries(bands.map((b) => [b.grade, b.count]))).toEqual({ A: 3, B: 1, C: 0, D: 1, F: 1 })
  })
})

describe('distribution tails', () => {
  it('matches standard tables', () => {
    expect(normalTwoSided(1.96)).toBeCloseTo(0.05, 3)
    expect(tTwoSided(2.228, 10)).toBeCloseTo(0.05, 3)
    expect(tTwoSided(0, 10)).toBeCloseTo(1, 6)
    expect(chiSquareUpper(3.841, 1)).toBeCloseTo(0.05, 3)
    expect(chiSquareUpper(5.991, 2)).toBeCloseTo(0.05, 3)
    expect(chiSquareUpper(7.815, 3)).toBeCloseTo(0.05, 2)
  })

  it('finds a clear difference and not an absent one', () => {
    expect(welchP([1, 2, 3, 4, 5], [11, 12, 13, 14, 15])!).toBeLessThan(0.001)
    expect(welchP([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])!).toBeCloseTo(1, 6)
  })

  it('computes Cronbach alpha', () => {
    // Items that agree perfectly are perfectly consistent.
    expect(cronbachAlpha([[1, 1, 1], [0, 0, 0], [1, 1, 1], [0, 0, 0]])).toBeCloseTo(1, 10)
    expect(cronbachAlpha([[1, 1]])).toBeNull()
  })
})

// ------------------------------------------------------------------ fixture

/** Deterministic PRNG so the synthetic class is the same on every run. */
function lcg(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const QUESTIONS = 20
const CHOICES = 4
const MISKEYED = 5 // variation B: the bank says c0, the best students know it is c1
const UNBALANCED = 7 // variation B is far harder than A
const ROW_EC = 30

function buildQuestions(): StatsQuestion[] {
  return Array.from({ length: QUESTIONS }, (_, qi) => {
    const order = qi + 1
    return {
      id: `q${order}`,
      order,
      title: null,
      points: 1,
      variations: ['A', 'B'].map((label) => ({
        id: `q${order}${label}`,
        label,
        summary: `Question ${order}${label}`,
        choices: Array.from({ length: CHOICES }, (_, ci) => ({
          id: `q${order}${label}-c${ci}`,
          label: LETTERS[ci],
          summary: `choice ${ci}`,
          isCorrect: ci === 0,
          pinToLast: false,
        })),
      })),
    }
  })
}

/**
 * A class whose answers follow a simple ability model, with three planted
 * problems for the analysis to find: a miskeyed variation, a variation far
 * harder than its sibling, and weak students running out of time.
 */
function buildClass(size = 300): StatsInput {
  const questions = buildQuestions()
  const rng = lcg(1301)
  const students: StatsStudent[] = Array.from({ length: size }, (_, s) => {
    const ability = -2 + (4 * s) / (size - 1)
    const responses: StatsResponse[] = questions.map((question, qi) => {
      const variation = question.variations[(s + qi) % 2]
      // Rotating the order and the choices per student, as real papers do, so a
      // letter never means the same choice on two neighbouring papers.
      const position = ((qi + s * 7) % QUESTIONS) + 1
      const rotation = s % CHOICES
      const choiceOrder = variation.choices.map((_, i) => variation.choices[(i + rotation) % CHOICES].id)

      const difficulty = question.order === UNBALANCED ? (variation.label === 'B' ? 2.5 : -1.5) : (qi % 5) - 2
      const knows = rng() < 1 / (1 + Math.exp(-(ability - difficulty) * 1.7))
      const outOfTime = ability < -1 && position > QUESTIONS - 4

      let chosen: string | null
      if (outOfTime) chosen = null
      else if (question.order === MISKEYED && variation.label === 'B') {
        chosen = knows ? `${variation.id}-c1` : variation.choices[[0, 2, 3][Math.floor(rng() * 3)]].id
      } else {
        chosen = knows ? `${variation.id}-c0` : variation.choices[1 + Math.floor(rng() * 3)].id
      }

      const letters = chosen ? [LETTERS[choiceOrder.indexOf(chosen)]] : []
      const correct = chosen === `${variation.id}-c0`
      return {
        position,
        runQuestionId: question.id,
        runVariationId: variation.id,
        choiceOrder,
        letters,
        verdict: !chosen ? 'blank' : correct ? 'correct' : 'incorrect',
        awarded: correct ? 1 : 0,
        possible: 1,
        overridden: false,
      }
    })
    const bonus = s % 2 === 0
    const earned = responses.reduce((sum, r) => sum + r.awarded, 0) + (bonus ? 1 : 0)
    return {
      status: 'graded',
      earned,
      possible: QUESTIONS,
      sections: [{ key: s % 3 === 0 ? 'A1' : 'B1', label: s % 3 === 0 ? 'A1' : 'B1' }],
      session: null,
      responses,
      extraCredit: { marked: true, correct: bonus },
    }
  })
  return { questions, students, extraCreditPosition: ROW_EC }
}

describe('computeExamStats', () => {
  const input = buildClass()
  const stats = computeExamStats(input)
  const item = (order: number) => stats.items.find((i) => i.order === order)!

  it('counts and summarizes the class on the recorded score', () => {
    expect(stats.counts).toEqual({ roster: 300, graded: 300, notTaken: 0 })
    expect(stats.possible).toBe(QUESTIONS)
    expect(stats.percent!.n).toBe(300)
    expect(stats.histogram.reduce((s, b) => s + b.count, 0)).toBe(300)
    expect(stats.bands.reduce((s, b) => s + b.count, 0)).toBe(300)
  })

  it('leaves the bonus row out of item analysis and reports it on its own', () => {
    expect(stats.items).toHaveLength(QUESTIONS)
    expect(stats.extraCredit).toMatchObject({ position: ROW_EC, attempted: 300, earned: 150 })
    expect(stats.extraCredit!.meanWithout!).toBeLessThan(stats.percent!.mean)
  })

  it('maps letters back to authored choices through each paper’s own order', () => {
    for (const v of item(1).variations) {
      const accounted = v.choices.reduce((s, c) => s + c.count, 0) + v.blank + v.multi + v.invalid
      expect(accounted).toBe(v.n)
      const key = v.choices.find((c) => c.isCorrect)!
      expect(key.count / v.n).toBeCloseTo(v.p!, 10)
    }
  })

  it('finds a well-behaved question unremarkable', () => {
    expect(item(1).discrimination!).toBeGreaterThan(DISCRIMINATION_FLOOR)
    expect(item(1).upperLower!).toBeGreaterThan(0)
    expect(item(1).quality).not.toBe('review')
    expect(item(1).variations.every((v) => v.suspectedMiskey === null)).toBe(true)
  })

  it('flags a miskeyed variation that strong students answered "wrong"', () => {
    const b = item(MISKEYED).variations.find((v) => v.label === 'B')!
    expect(b.suspectedMiskey?.label).toBe('B')
    expect(item(MISKEYED).quality).toBe('review')
    // Including its sibling, a hard question whose top students guess noisily.
    const falseAlarms = stats.items.flatMap((i) =>
      i.variations.filter((v) => v.suspectedMiskey && v.variationId !== `q${MISKEYED}B`).map((v) => v.variationId),
    )
    expect(falseAlarms).toEqual([])
    expect(stats.insights[0]).toMatchObject({ severity: 'critical', question: MISKEYED })
    expect(stats.insights[0].title).toMatch(/variation B may be miskeyed/)
  })

  it('detects a variation much harder than its sibling', () => {
    const test = item(UNBALANCED).variationTest!
    expect(test.significant).toBe(true)
    expect(test.spread).toBeGreaterThan(0.3)
    expect(stats.insights.some((i) => i.question === UNBALANCED && /variation B was much harder than A/.test(i.title))).toBe(true)
    expect(stats.variationLuck!.max).toBeGreaterThan(0)
  })

  it('sees blanks piling up at the end of the paper', () => {
    const pe = stats.positionEffect!
    expect(pe.late.blankRate).toBeGreaterThan(pe.early.blankRate)
    expect(stats.insights.some((i) => i.title === 'Students may have run out of time')).toBe(true)
  })

  it('measures a consistent exam as reliable', () => {
    expect(stats.reliability!.alpha).toBeGreaterThan(0.6)
    expect(stats.reliability!.sem).toBeGreaterThan(0)
  })

  it('compares sections against everyone else', () => {
    expect(stats.sections.map((s) => s.label)).toEqual(['A1', 'B1'])
    expect(stats.sections.reduce((s, g) => s + g.n, 0)).toBe(300)
  })

  it('orders insights most urgent first', () => {
    const rank = { critical: 0, warning: 1, info: 2, good: 3 }
    const ranks = stats.insights.map((i) => rank[i.severity])
    expect(ranks).toEqual(ranks.slice().sort((a, b) => a - b))
  })

  it('holds back question-level statistics for a handful of students', () => {
    const small = computeExamStats({ ...input, students: input.students.slice(0, 10) })
    expect(small.smallSample).toBe(true)
    expect(small.reliability).not.toBeNull()
    expect(small.items.every((i) => i.discrimination === null && i.upperLower === null)).toBe(true)
    expect(small.positionEffect).toBeNull()
    expect(small.insights.some((i) => /Only 10 students graded/.test(i.title))).toBe(true)
  })

  it('excludes students with no scanned sheet from every number', () => {
    const absent: StatsStudent = {
      status: 'not_taken',
      earned: 0,
      possible: QUESTIONS,
      sections: [{ key: 'A1', label: 'A1' }],
      session: null,
      responses: [],
      extraCredit: null,
    }
    const withAbsent = computeExamStats({ ...input, students: [...input.students, absent] })
    expect(withAbsent.counts).toEqual({ roster: 301, graded: 300, notTaken: 1 })
    expect(withAbsent.percent!.mean).toBeCloseTo(stats.percent!.mean, 10)
    expect(withAbsent.insights.some((i) => /1 student had no scanned sheet/.test(i.title))).toBe(true)
  })

  it('notices later sessions scoring higher', () => {
    const sessions = [0, 1, 2].map((i) => ({
      key: `s${i}`,
      label: `Session ${i + 1}`,
      at: new Date(2026, 9, 20 + i),
      kind: 'session' as const,
    }))
    // Assigned by score so the last session holds the strongest students.
    const ranked = input.students.slice().sort((a, b) => a.earned - b.earned)
    const students = ranked.map((s, i) => ({ ...s, session: sessions[Math.floor((i * 3) / ranked.length)] }))
    const trended = computeExamStats({ ...input, students })
    expect(trended.sessions.map((s) => s.label)).toEqual(['Session 1', 'Session 2', 'Session 3'])
    expect(trended.sessionTrend!.r).toBeGreaterThan(0.5)
    expect(trended.insights.some((i) => i.title === 'Later sessions scored higher')).toBe(true)
  })
})

const DISCRIMINATION_FLOOR = 0.2
