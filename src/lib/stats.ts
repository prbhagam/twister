import { LETTERS } from './seed'
import type { Verdict } from './grading'

/**
 * Exam statistics and item analysis for one graded run.
 *
 * Everything here is pure: the loader in stats-data.ts flattens the database into
 * a `StatsInput`, and this module turns it into numbers and plain-English insights.
 *
 * Two properties of TWISTER papers make this richer than a classic scantron
 * report, and both are leaned on below:
 *
 *   * Each position maps back to the exact variation and authored choice the
 *     student saw, so distractor analysis is done per *choice*, not per letter —
 *     a letter means something different on every paper.
 *   * Question order is shuffled per student, so the effect of where a question
 *     sat on the paper (fatigue, running out of time) is measurable without being
 *     confounded by which question happened to be there.
 *
 * The extra-credit row is left out of item analysis and reliability. It is
 * optional and the same for everyone, so it says nothing about the exam's
 * questions; it is reported on its own.
 */

// ------------------------------------------------------------------- input

export interface StatsChoice {
  id: string
  /** The choice's letter in the authored bank (its order), not on any paper. */
  label: string
  summary: string
  isCorrect: boolean
  pinToLast: boolean
}

export interface StatsVariation {
  id: string
  label: string
  summary: string
  choices: StatsChoice[]
}

export interface StatsQuestion {
  id: string
  order: number
  title: string | null
  points: number
  variations: StatsVariation[]
}

export interface StatsResponse {
  position: number
  runQuestionId: string
  runVariationId: string
  /** choiceOrder[0] was printed as A on this student's paper, and so on. */
  choiceOrder: string[]
  letters: string[]
  verdict: Verdict
  awarded: number
  possible: number
  overridden: boolean
}

export interface StatsGroupRef {
  key: string
  label: string
  /** Session buckets only; orders sessions chronologically for the trend test. */
  at?: Date | null
  kind?: 'session' | 'exception' | 'not_signed_up'
}

export interface StatsStudent {
  status: string
  earned: number
  possible: number
  sections: StatsGroupRef[]
  session: StatsGroupRef | null
  /** The paper's own questions; the bonus row is reported via `extraCredit`. */
  responses: StatsResponse[]
  extraCredit: { marked: boolean; correct: boolean } | null
}

export interface StatsInput {
  questions: StatsQuestion[]
  students: StatsStudent[]
  extraCreditPosition: number | null
}

// ------------------------------------------------------------------ output

export interface Summary {
  n: number
  mean: number
  sd: number
  median: number
  min: number
  max: number
  q1: number
  q3: number
  p10: number
  p90: number
  skewness: number
}

export interface HistogramBin {
  /** Inclusive lower bound, in points. */
  from: number
  /** Exclusive upper bound, in points (the top bin also holds anything above). */
  to: number
  count: number
}

export interface GradeBand {
  grade: string
  /** Inclusive lower bound, in percent. */
  min: number
  count: number
}

export interface ChoiceStats {
  choiceId: string
  label: string
  summary: string
  isCorrect: boolean
  pinToLast: boolean
  count: number
  /** Share of this variation's takers who marked it. */
  rate: number
  /** The same share within the top and bottom 27% of the class by total score. */
  upperRate: number | null
  lowerRate: number | null
  /** Mean exam percent of the students who marked it. */
  chooserMean: number | null
  /** A wrong choice so few people picked that it is not doing any work. */
  nonFunctional: boolean
}

export interface VariationStats {
  variationId: string
  label: string
  summary: string
  n: number
  p: number | null
  discrimination: number | null
  blank: number
  multi: number
  invalid: number
  choices: ChoiceStats[]
  /** Set when stronger students preferred a wrong choice to the key. */
  suspectedMiskey: ChoiceStats | null
}

export interface VariationTest {
  chi2: number
  df: number
  pValue: number
  /** Highest minus lowest variation p. */
  spread: number
  significant: boolean
}

export type ItemQuality = 'good' | 'fair' | 'weak' | 'review'

export interface ItemStats {
  questionId: string
  order: number
  title: string | null
  summary: string
  points: number
  multipleCorrect: boolean
  n: number
  /** Difficulty index: mean share of the points earned. */
  p: number | null
  /** Corrected point-biserial: the item against the rest of the exam. */
  discrimination: number | null
  /** Discrimination below zero by more than noise: stronger students did worse. */
  negativeDiscrimination: boolean
  /** Upper-minus-lower 27% difficulty. */
  upperLower: number | null
  blankRate: number
  multiRate: number
  outOfRangeRate: number
  overridden: number
  variations: VariationStats[]
  variationTest: VariationTest | null
  quality: ItemQuality
  reasons: string[]
}

export interface PositionStats {
  position: number
  n: number
  p: number | null
  blankRate: number
}

export interface PositionEffect {
  /** Positions in the first and last quarter of the paper. */
  early: { from: number; to: number; p: number; blankRate: number; n: number }
  late: { from: number; to: number; p: number; blankRate: number; n: number }
  pValueCorrect: number
  pValueBlank: number
}

export interface GroupStats {
  key: string
  label: string
  kind?: StatsGroupRef['kind']
  at?: Date | null
  n: number
  mean: number | null
  median: number | null
  sd: number | null
  /** Mean minus the mean of everyone outside the group, in percentage points. */
  diff: number | null
  pValue: number | null
}

export interface SessionTrend {
  r: number
  pValue: number
  firstMean: number
  lastMean: number
}

export interface VariationLuck {
  /** In points: how much a student's variation draw moved their expected score. */
  sd: number
  min: number
  max: number
  /** Share of students whose draw moved them by at least one point. */
  overOnePoint: number
}

export type InsightSeverity = 'critical' | 'warning' | 'info' | 'good'

export interface Insight {
  severity: InsightSeverity
  title: string
  detail: string
  /** Authored question order, for linking to that question's row. */
  question?: number
}

export interface ExamStats {
  counts: { roster: number; graded: number; notTaken: number }
  /** The most common `possible`; every student's is the same unless blanks differ. */
  possible: number
  /** Exam percent as recorded (bonus included), over graded students. */
  percent: Summary | null
  /** Raw points as recorded. */
  points: Summary | null
  histogram: HistogramBin[]
  bands: GradeBand[]
  reliability: { alpha: number; sem: number; items: number } | null
  responses: {
    total: number
    blank: number
    multi: number
    outOfRange: number
    overridden: number
    unresolvedFlags: number
  }
  extraCredit: { position: number; attempted: number; earned: number; meanWithout: number | null } | null
  items: ItemStats[]
  positions: PositionStats[]
  positionEffect: PositionEffect | null
  variationLuck: VariationLuck | null
  sections: GroupStats[]
  sessions: GroupStats[]
  sessionTrend: SessionTrend | null
  insights: Insight[]
  /** Below this many graded students, item statistics are too noisy to act on. */
  smallSample: boolean
}

// --------------------------------------------------------------- thresholds

/** Share of the class in each of the upper and lower groups (Kelley's 27%). */
const GROUP_SHARE = 0.27
export const MIN_STUDENTS_FOR_ITEMS = 20
const MIN_PER_VARIATION = 10
const NON_FUNCTIONAL_RATE = 0.02
const MIN_FOR_NON_FUNCTIONAL = 30
const SIGNIFICANCE = 0.01
const MIN_GROUP = 10

export const DISCRIMINATION_GOOD = 0.3
export const DISCRIMINATION_FAIR = 0.15
export const HARD_P = 0.3
export const NEAR_ZERO_P = 0.1
export const EASY_P = 0.95

export const GRADE_BANDS: { grade: string; min: number }[] = [
  { grade: 'A', min: 90 },
  { grade: 'B', min: 80 },
  { grade: 'C', min: 70 },
  { grade: 'D', min: 60 },
  { grade: 'F', min: 0 },
]

// ------------------------------------------------------------ basic numbers

export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

/** Sample variance (n - 1). Zero for fewer than two values. */
export function variance(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)
}

/** Linear-interpolated quantile of an ascending array (type 7, as spreadsheets do). */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const at = (sorted.length - 1) * q
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

export function summarize(xs: number[]): Summary | null {
  if (xs.length === 0) return null
  const sorted = xs.slice().sort((a, b) => a - b)
  const m = mean(xs)
  const sd = Math.sqrt(variance(xs))
  const n = xs.length
  const skewness =
    sd > 0 && n > 2
      ? (n / ((n - 1) * (n - 2))) * xs.reduce((s, x) => s + ((x - m) / sd) ** 3, 0)
      : 0
  return {
    n,
    mean: m,
    sd,
    median: quantile(sorted, 0.5),
    min: sorted[0],
    max: sorted[n - 1],
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
    skewness,
  }
}

/** Pearson correlation, or null when either side has no variance. */
export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null
  const mx = mean(xs)
  const my = mean(ys)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

// ------------------------------------------------------- distribution tails

/** Complementary error function (Numerical Recipes erfcc; |error| < 1.2e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    )
  return x >= 0 ? r : 2 - r
}

/** Two-sided p-value for a standard normal statistic. */
export function normalTwoSided(z: number): number {
  return erfc(Math.abs(z) / Math.SQRT2)
}

function logGamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5)
  let ser = 1.000000000190015
  for (const coefficient of c) ser += coefficient / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const EPS = 3e-14
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2)
    ? (front * betaContinuedFraction(a, b, x)) / a
    : 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b
}

/** Two-sided p-value for Student's t with `df` degrees of freedom. */
export function tTwoSided(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0
  return incompleteBeta(df / (df + t * t), df / 2, 0.5)
}

/** Upper-tail p-value of a chi-square statistic. */
export function chiSquareUpper(x: number, df: number): number {
  if (x <= 0) return 1
  if (df === 1) return erfc(Math.sqrt(x / 2))
  if (df === 2) return Math.exp(-x / 2)
  // Wilson–Hilferty; the exam only ever has 2–3 variations, so this is a fallback.
  const z = (Math.cbrt(x / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df))
  return erfc(z / Math.SQRT2) / 2
}

/** Two-proportion z-test, two-sided. */
export function twoProportionP(x1: number, n1: number, x2: number, n2: number): number {
  if (n1 === 0 || n2 === 0) return 1
  const pooled = (x1 + x2) / (n1 + n2)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
  if (se === 0) return 1
  return normalTwoSided((x1 / n1 - x2 / n2) / se)
}

/** Welch's t-test, two-sided. Null when either side is too small to have a variance. */
export function welchP(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null
  const va = variance(a) / a.length
  const vb = variance(b) / b.length
  const se = Math.sqrt(va + vb)
  if (se === 0) return mean(a) === mean(b) ? 1 : 0
  const t = (mean(a) - mean(b)) / se
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1))
  return tTwoSided(t, df)
}

/** Two-sided p-value that a Pearson correlation over n pairs is zero. */
export function correlationP(r: number, n: number): number {
  if (n < 3) return 1
  const t = (r * Math.sqrt(n - 2)) / Math.sqrt(Math.max(1e-12, 1 - r * r))
  return tTwoSided(t, n - 2)
}

/** Cronbach's alpha (KR-20 when every item is scored 0/1). */
export function cronbachAlpha(itemScores: number[][]): number | null {
  const students = itemScores.length
  const k = itemScores[0]?.length ?? 0
  if (students < 3 || k < 2) return null
  let itemVar = 0
  for (let i = 0; i < k; i++) itemVar += variance(itemScores.map((row) => row[i]))
  const totalVar = variance(itemScores.map((row) => row.reduce((s, x) => s + x, 0)))
  if (totalVar === 0) return null
  return (k / (k - 1)) * (1 - itemVar / totalVar)
}

/**
 * Histogram over raw points with whole-point bins, widened to keep around 50
 * bars at most. Bins are a whole number of points wide so every bin can hold the
 * same number of possible scores — percent bins on a 50-point exam would hold
 * two scores in some and three in others and draw a comb that is not in the data.
 */
export function histogram(scores: number[], possible: number): HistogramBin[] {
  const top = Math.max(possible, ...scores.map(Math.floor))
  const width = Math.max(1, Math.ceil((top + 1) / 50))
  const bins: HistogramBin[] = []
  for (let from = 0; from <= top; from += width) bins.push({ from, to: from + width, count: 0 })
  for (const score of scores) {
    const index = Math.min(bins.length - 1, Math.max(0, Math.floor(Math.floor(score) / width)))
    bins[index].count++
  }
  return bins
}

export function gradeBands(percents: number[]): GradeBand[] {
  return GRADE_BANDS.map((band, i) => {
    const ceiling = i === 0 ? Infinity : GRADE_BANDS[i - 1].min
    return {
      ...band,
      count: percents.filter((p) => p >= band.min && p < ceiling).length,
    }
  })
}

// --------------------------------------------------------------- formatting

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`
}

function questionName(item: Pick<ItemStats, 'order' | 'title'>): string {
  return item.title ? `Q${item.order} (${item.title})` : `Q${item.order}`
}

function listQuestions(items: ItemStats[], max = 8): string {
  const names = items.slice(0, max).map((i) => `Q${i.order}`)
  return items.length > max ? `${names.join(', ')} and ${items.length - max} more` : names.join(', ')
}

// ------------------------------------------------------------------ analysis

type ResponseOutcome = { kind: 'choices'; choiceIds: string[] } | { kind: 'blank' | 'multi' | 'invalid' }

/** What a response says about the authored choices, independent of letters. */
function outcomeOf(response: StatsResponse): ResponseOutcome {
  if (response.verdict === 'blank') return { kind: 'blank' }
  if (response.verdict === 'multi') return { kind: 'multi' }
  if (response.verdict === 'out_of_range') return { kind: 'invalid' }
  const choiceIds = response.letters
    .map((letter) => response.choiceOrder[LETTERS.indexOf(letter as (typeof LETTERS)[number])])
    .filter((id): id is string => Boolean(id))
  return { kind: 'choices', choiceIds }
}

function itemScore(response: StatsResponse): number {
  return response.possible > 0 ? response.awarded / response.possible : 0
}

function isCorrect(response: StatsResponse): boolean {
  return response.possible > 0 && response.awarded >= response.possible
}

function percentOf(student: StatsStudent): number {
  return student.possible > 0 ? (student.earned / student.possible) * 100 : 0
}

/** Groups hold student indices, so a student in two sections is only ever on one
 * side of each group's comparison against everyone else. */
function groupStats(
  groups: Map<string, { ref: StatsGroupRef; members: Set<number> }>,
  percents: number[],
): GroupStats[] {
  return [...groups.values()].map(({ ref, members }) => {
    const scores = [...members].map((i) => percents[i])
    const rest = percents.filter((_, i) => !members.has(i))
    const summary = summarize(scores)
    return {
      key: ref.key,
      label: ref.label,
      kind: ref.kind,
      at: ref.at,
      n: scores.length,
      mean: summary?.mean ?? null,
      median: summary?.median ?? null,
      sd: summary ? summary.sd : null,
      diff: summary && rest.length ? summary.mean - mean(rest) : null,
      pValue: welchP(scores, rest),
    }
  })
}

export function computeExamStats(input: StatsInput): ExamStats {
  const graded = input.students.filter((s) => s.status === 'graded')
  const notTaken = input.students.filter((s) => s.status === 'not_taken').length
  const percents = graded.map(percentOf)
  const possibleCounts = new Map<number, number>()
  for (const s of input.students) possibleCounts.set(s.possible, (possibleCounts.get(s.possible) ?? 0) + 1)
  const possible =
    [...possibleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    input.questions.reduce((sum, q) => sum + q.points, 0)

  // Totals for item analysis are over the paper's own questions only.
  const itemTotals = graded.map((s) => s.responses.reduce((sum, r) => sum + r.awarded, 0))
  const smallSample = graded.length < MIN_STUDENTS_FOR_ITEMS

  // ---- reliability: needs every item for every student
  const questionIds = input.questions.map((q) => q.id)
  const complete = graded
    .map((s) => {
      const byQuestion = new Map(s.responses.map((r) => [r.runQuestionId, r.awarded]))
      return questionIds.every((id) => byQuestion.has(id)) ? questionIds.map((id) => byQuestion.get(id)!) : null
    })
    .filter((row): row is number[] => row !== null)
  const alpha = cronbachAlpha(complete)
  const completeTotals = complete.map((row) => row.reduce((s, x) => s + x, 0))
  const reliability =
    alpha === null
      ? null
      : {
          alpha,
          sem: Math.sqrt(variance(completeTotals)) * Math.sqrt(1 - Math.min(1, Math.max(0, alpha))),
          items: questionIds.length,
        }

  // ---- response-level tallies
  const all = graded.flatMap((s) => s.responses)
  const responses = {
    total: all.length,
    blank: all.filter((r) => r.verdict === 'blank').length,
    multi: all.filter((r) => r.verdict === 'multi').length,
    outOfRange: all.filter((r) => r.verdict === 'out_of_range').length,
    overridden: all.filter((r) => r.overridden).length,
    unresolvedFlags: all.filter((r) => ['blank', 'multi', 'out_of_range'].includes(r.verdict) && !r.overridden).length,
  }

  // ---- items
  const items: ItemStats[] = input.questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((question) => {
      const taken: { student: number; response: StatsResponse }[] = []
      graded.forEach((s, student) => {
        for (const response of s.responses) {
          if (response.runQuestionId === question.id) taken.push({ student, response })
        }
      })
      const n = taken.length
      const scores = taken.map((t) => itemScore(t.response))
      const rest = taken.map((t) => itemTotals[t.student] - t.response.awarded)
      const multipleCorrect = question.variations.some((v) => v.choices.filter((c) => c.isCorrect).length > 1)

      // Upper and lower 27% by score on the *rest* of the exam, so the item does not
      // vote for its own discrimination — the same correction as the point-biserial
      // above, which keeps the two measures telling the same story. Ties at the cut
      // fall in input order: stable and arbitrary, the standard compromise.
      const byRest = taken.map((_, i) => i).sort((a, b) => rest[b] - rest[a])
      const groupSize = Math.round(n * GROUP_SHARE)
      const enough = !smallSample && groupSize >= 3
      const upper = new Set(enough ? byRest.slice(0, groupSize).map((i) => taken[i].student) : [])
      const lower = new Set(enough ? byRest.slice(-groupSize).map((i) => taken[i].student) : [])
      const inGroup = (group: Set<number>) => taken.filter((t) => group.has(t.student))
      const upperTaken = inGroup(upper)
      const lowerTaken = inGroup(lower)
      const upperLower =
        upperTaken.length && lowerTaken.length
          ? mean(upperTaken.map((t) => itemScore(t.response))) - mean(lowerTaken.map((t) => itemScore(t.response)))
          : null

      const variations: VariationStats[] = question.variations.map((variation) => {
        const vt = taken.filter((t) => t.response.runVariationId === variation.id)
        const vUpper = vt.filter((t) => upper.has(t.student))
        const vLower = vt.filter((t) => lower.has(t.student))
        let blank = 0
        let multi = 0
        let invalid = 0
        // Student index -> the authored choices they marked on this variation.
        const marked = new Map<number, string[]>()
        for (const t of vt) {
          const outcome = outcomeOf(t.response)
          if (outcome.kind === 'choices') marked.set(t.student, outcome.choiceIds)
          else if (outcome.kind === 'blank') blank++
          else if (outcome.kind === 'multi') multi++
          else invalid++
        }
        const chosenBy = new Map<string, number[]>()
        for (const [student, ids] of marked) {
          for (const id of ids) chosenBy.set(id, (chosenBy.get(id) ?? []).concat(student))
        }
        const rateIn = (group: typeof vt, choiceId: string) =>
          group.length
            ? group.filter((t) => marked.get(t.student)?.includes(choiceId)).length / group.length
            : null

        const choices: ChoiceStats[] = variation.choices.map((choice) => {
          const choosers = chosenBy.get(choice.id) ?? []
          const rate = vt.length ? choosers.length / vt.length : 0
          return {
            choiceId: choice.id,
            label: choice.label,
            summary: choice.summary,
            isCorrect: choice.isCorrect,
            pinToLast: choice.pinToLast,
            count: choosers.length,
            rate,
            upperRate: rateIn(vUpper, choice.id),
            lowerRate: rateIn(vLower, choice.id),
            chooserMean: choosers.length ? mean(choosers.map((i) => percents[i])) : null,
            nonFunctional: !choice.isCorrect && vt.length >= MIN_FOR_NON_FUNCTIONAL && rate < NON_FUNCTIONAL_RATE,
          }
        })

        // A wrong choice the top of the class picked more often than the key is
        // the classic signature of a miskey, or of a key that is defensibly wrong.
        let suspectedMiskey: ChoiceStats | null = null
        if (!multipleCorrect && vt.length >= MIN_PER_VARIATION && vUpper.length >= 3) {
          const key = choices.find((c) => c.isCorrect)
          const rival = choices
            .filter((c) => !c.isCorrect)
            .sort((a, b) => (b.upperRate ?? 0) - (a.upperRate ?? 0))[0]
          // Judged on the groups rather than on overall popularity: on a hard
          // question the rest of the class guesses across every choice and hides
          // the signal. Both halves are needed — the rival must attract strong
          // students, and the key must fail to. A hard but correct key still
          // draws more of the top than the bottom, which is what keeps sampling
          // noise among the top group's guesses from tripping this.
          if (
            key &&
            rival &&
            (rival.upperRate ?? 0) > (key.upperRate ?? 0) &&
            (rival.upperRate ?? 0) >= 0.25 &&
            (rival.upperRate ?? 0) > (rival.lowerRate ?? 0) &&
            (key.upperRate ?? 0) <= (key.lowerRate ?? 0)
          ) {
            suspectedMiskey = rival
          }
        }

        return {
          variationId: variation.id,
          label: variation.label,
          summary: variation.summary,
          n: vt.length,
          p: vt.length ? mean(vt.map((t) => itemScore(t.response))) : null,
          discrimination: smallSample
            ? null
            : pearson(
                vt.map((t) => itemScore(t.response)),
                vt.map((t) => itemTotals[t.student] - t.response.awarded),
              ),
          blank,
          multi,
          invalid,
          choices,
          suspectedMiskey,
        }
      })

      // Variations are drawn at random, so a real difference in how often each was
      // answered correctly is a difference in the variations, not the students.
      let variationTest: VariationTest | null = null
      const testable = variations.filter((v) => v.n > 0)
      if (testable.length >= 2 && testable.every((v) => v.n >= MIN_PER_VARIATION)) {
        const correctBy = testable.map(
          (v) => taken.filter((t) => t.response.runVariationId === v.variationId && isCorrect(t.response)).length,
        )
        const totalCorrect = correctBy.reduce((s, x) => s + x, 0)
        const expectedOk = testable.every(
          (v) => (v.n * totalCorrect) / n >= 5 && (v.n * (n - totalCorrect)) / n >= 5,
        )
        if (expectedOk && totalCorrect > 0 && totalCorrect < n) {
          let chi2 = 0
          testable.forEach((v, i) => {
            const eCorrect = (v.n * totalCorrect) / n
            const eWrong = v.n - eCorrect
            chi2 += (correctBy[i] - eCorrect) ** 2 / eCorrect + (v.n - correctBy[i] - eWrong) ** 2 / eWrong
          })
          const df = testable.length - 1
          const pValue = chiSquareUpper(chi2, df)
          const ps = testable.map((v) => v.p ?? 0)
          const spread = Math.max(...ps) - Math.min(...ps)
          variationTest = { chi2, df, pValue, spread, significant: pValue < SIGNIFICANCE && spread >= 0.1 }
        }
      }

      const verdictRate = (verdict: Verdict) => (n ? taken.filter((t) => t.response.verdict === verdict).length / n : 0)
      const p = n ? mean(scores) : null
      const discrimination = smallSample ? null : pearson(scores, rest)

      const reasons: string[] = []
      const miskeyed = variations.filter((v) => v.suspectedMiskey)
      if (miskeyed.length) reasons.push(`possible miskey (variation ${miskeyed.map((v) => v.label).join(', ')})`)
      const negativeDiscrimination =
        discrimination !== null && discrimination <= -0.05 && correlationP(discrimination, n) < 0.05
      if (negativeDiscrimination) reasons.push('negative discrimination')
      if (p !== null && n >= MIN_GROUP && p < NEAR_ZERO_P && !miskeyed.length) reasons.push('almost nobody answered correctly')
      if (variationTest?.significant) reasons.push('variations differ in difficulty')

      let quality: ItemQuality
      if (reasons.length) quality = 'review'
      else if (discrimination === null) quality = 'fair'
      else if (discrimination >= DISCRIMINATION_GOOD) quality = 'good'
      else if (discrimination >= DISCRIMINATION_FAIR || (p !== null && p >= 0.9)) quality = 'fair'
      else quality = 'weak'

      return {
        questionId: question.id,
        order: question.order,
        title: question.title,
        summary: question.variations[0]?.summary ?? '',
        points: question.points,
        multipleCorrect,
        n,
        p,
        discrimination,
        negativeDiscrimination,
        upperLower: smallSample ? null : upperLower,
        blankRate: verdictRate('blank'),
        multiRate: verdictRate('multi'),
        outOfRangeRate: verdictRate('out_of_range'),
        overridden: taken.filter((t) => t.response.overridden).length,
        variations,
        variationTest,
        quality,
        reasons,
      }
    })

  // ---- position on the paper
  const byPosition = new Map<number, StatsResponse[]>()
  for (const r of all) {
    const at = byPosition.get(r.position) ?? []
    at.push(r)
    byPosition.set(r.position, at)
  }
  const positions: PositionStats[] = [...byPosition.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([position, rs]) => ({
      position,
      n: rs.length,
      p: rs.length ? mean(rs.map(itemScore)) : null,
      blankRate: rs.length ? rs.filter((r) => r.verdict === 'blank').length / rs.length : 0,
    }))

  let positionEffect: PositionEffect | null = null
  const lastPosition = positions.at(-1)?.position ?? 0
  if (lastPosition >= 8 && !smallSample) {
    const quarter = Math.max(1, Math.floor(lastPosition / 4))
    const span = (from: number, to: number) => {
      const rs = all.filter((r) => r.position >= from && r.position <= to)
      return {
        from,
        to,
        n: rs.length,
        correct: rs.filter(isCorrect).length,
        blanks: rs.filter((r) => r.verdict === 'blank').length,
        p: rs.length ? mean(rs.map(itemScore)) : 0,
        blankRate: rs.length ? rs.filter((r) => r.verdict === 'blank').length / rs.length : 0,
      }
    }
    const early = span(1, quarter)
    const late = span(lastPosition - quarter + 1, lastPosition)
    positionEffect = {
      early: { from: early.from, to: early.to, p: early.p, blankRate: early.blankRate, n: early.n },
      late: { from: late.from, to: late.to, p: late.p, blankRate: late.blankRate, n: late.n },
      pValueCorrect: twoProportionP(early.correct, early.n, late.correct, late.n),
      pValueBlank: twoProportionP(early.blanks, early.n, late.blanks, late.n),
    }
  }

  // ---- variation luck: how far each student's draw moved their expected score
  const variationP = new Map<string, number>()
  const itemP = new Map<string, number>()
  for (const item of items) {
    if (item.p !== null) itemP.set(item.questionId, item.p)
    for (const v of item.variations) if (v.p !== null && v.n >= MIN_PER_VARIATION) variationP.set(v.variationId, v.p)
  }
  let variationLuck: VariationLuck | null = null
  const multiVariation = input.questions.some((q) => q.variations.length > 1)
  if (multiVariation && !smallSample) {
    const luck = graded.map((s) =>
      s.responses.reduce((sum, r) => {
        const vp = variationP.get(r.runVariationId)
        const qp = itemP.get(r.runQuestionId)
        return vp === undefined || qp === undefined ? sum : sum + (vp - qp) * r.possible
      }, 0),
    )
    variationLuck = {
      sd: Math.sqrt(variance(luck)),
      min: Math.min(...luck),
      max: Math.max(...luck),
      overOnePoint: luck.filter((x) => Math.abs(x) >= 1).length / luck.length,
    }
  }

  // ---- sections and sessions
  const sectionGroups = new Map<string, { ref: StatsGroupRef; members: Set<number> }>()
  const sessionGroups = new Map<string, { ref: StatsGroupRef; members: Set<number> }>()
  const join = (groups: typeof sectionGroups, ref: StatsGroupRef, student: number) => {
    const group = groups.get(ref.key) ?? { ref, members: new Set<number>() }
    group.members.add(student)
    groups.set(ref.key, group)
  }
  graded.forEach((s, i) => {
    for (const section of s.sections) join(sectionGroups, section, i)
    if (s.session) join(sessionGroups, s.session, i)
  })
  const sections = sectionGroups.size > 1 ? groupStats(sectionGroups, percents).sort((a, b) => a.label.localeCompare(b.label)) : []
  const kindOrder = { session: 0, exception: 1, not_signed_up: 2 } as const
  const sessions =
    sessionGroups.size > 1
      ? groupStats(sessionGroups, percents).sort(
          (a, b) =>
            kindOrder[a.kind ?? 'exception'] - kindOrder[b.kind ?? 'exception'] ||
            (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0) ||
            a.label.localeCompare(b.label),
        )
      : []

  // Do later sessions score higher? That is what it looks like when content
  // leaks from one sitting to the next.
  let sessionTrend: SessionTrend | null = null
  const timed = sessions.filter((g) => g.kind === 'session' && g.at)
  if (timed.length >= 2) {
    const indexByKey = new Map(timed.map((g, i) => [g.key, i]))
    const xs: number[] = []
    const ys: number[] = []
    graded.forEach((s, i) => {
      const index = s.session ? indexByKey.get(s.session.key) : undefined
      if (index !== undefined) {
        xs.push(index)
        ys.push(percents[i])
      }
    })
    const r = pearson(xs, ys)
    if (r !== null && xs.length > 3) {
      sessionTrend = {
        r,
        pValue: correlationP(r, xs.length),
        firstMean: timed[0].mean ?? 0,
        lastMean: timed.at(-1)!.mean ?? 0,
      }
    }
  }

  // ---- extra credit
  const ecStudents = graded.filter((s) => s.extraCredit)
  const extraCredit =
    input.extraCreditPosition !== null
      ? {
          position: input.extraCreditPosition,
          attempted: ecStudents.filter((s) => s.extraCredit!.marked).length,
          earned: ecStudents.filter((s) => s.extraCredit!.correct).length,
          meanWithout: graded.length
            ? mean(graded.map((s, i) => (s.possible > 0 ? (itemTotals[i] / s.possible) * 100 : 0)))
            : null,
        }
      : null

  const stats: ExamStats = {
    counts: { roster: input.students.length, graded: graded.length, notTaken },
    possible,
    percent: summarize(percents),
    points: summarize(graded.map((s) => s.earned)),
    histogram: graded.length ? histogram(graded.map((s) => s.earned), possible) : [],
    bands: gradeBands(percents),
    reliability,
    responses,
    extraCredit,
    items,
    positions,
    positionEffect,
    variationLuck,
    sections,
    sessions,
    sessionTrend,
    insights: [],
    smallSample,
  }
  stats.insights = buildInsights(stats)
  return stats
}

// ------------------------------------------------------------------ insights

const SEVERITY_ORDER: Record<InsightSeverity, number> = { critical: 0, warning: 1, info: 2, good: 3 }
/** Past this many questions sharing one problem, they are reported as a group. */
const GROUP_INSIGHTS_ABOVE = 3

/**
 * Plain-English observations, most urgent first. Each rule is conservative about
 * sample size and significance: a false alarm about a question costs an
 * instructor an hour, so a rule says nothing rather than guess.
 */
export function buildInsights(stats: ExamStats): Insight[] {
  const out: Insight[] = []
  const { items, percent, counts } = stats
  if (!percent) return out

  if (stats.smallSample) {
    out.push({
      severity: 'info',
      title: `Only ${plural(counts.graded, 'student')} graded`,
      detail: `Discrimination, reliability, and most question-level checks need at least ${MIN_STUDENTS_FOR_ITEMS} graded students to mean anything, so they are left out.`,
    })
  }

  // -- grading hygiene first: these change the numbers below
  if (stats.responses.unresolvedFlags > 0) {
    out.push({
      severity: 'warning',
      title: `${plural(stats.responses.unresolvedFlags, 'flagged response')} still unresolved`,
      detail:
        'Blank, double-bubbled, or out-of-range marks scored 0 and have not been reviewed. Resolve them on the run page before treating these statistics as final.',
    })
  }

  // -- miskeys
  for (const item of items) {
    for (const v of item.variations) {
      const rival = v.suspectedMiskey
      if (!rival) continue
      const key = v.choices.find((c) => c.isCorrect)
      out.push({
        severity: 'critical',
        question: item.order,
        title: `${questionName(item)}${item.variations.length > 1 ? ` variation ${v.label}` : ''} may be miskeyed`,
        detail:
          `Among the top 27% of the class, ${pct(rival.upperRate ?? 0)} chose ${rival.label} ("${rival.summary}") and only ` +
          `${pct(key?.upperRate ?? 0)} chose the key ${key?.label ?? '?'} (overall: ${pct(rival.rate)} vs ${pct(key?.rate ?? 0)}). ` +
          `Check the key; if ${rival.label} is defensible, override it for affected students.`,
      })
    }
  }

  // -- per-question rules. Each names its questions individually, until more
  // than a handful share the same problem: then one grouped insight says so,
  // rather than burying everything else under a wall of near-identical cards.
  const perQuestion = (
    matching: ItemStats[],
    severity: InsightSeverity,
    one: (item: ItemStats) => Omit<Insight, 'severity' | 'question'>,
    many: (items: ItemStats[]) => Omit<Insight, 'severity'>,
  ) => {
    if (matching.length > GROUP_INSIGHTS_ABOVE) out.push({ severity, ...many(matching) })
    else for (const item of matching) out.push({ severity, question: item.order, ...one(item) })
  }
  const miskeyed = (item: ItemStats) => item.variations.some((v) => v.suspectedMiskey)

  // Almost nobody right is far more often a wrong key than a hard question.
  perQuestion(
    items.filter((i) => i.p !== null && i.n >= MIN_GROUP && i.p < NEAR_ZERO_P && !miskeyed(i)),
    'critical',
    (item) => ({
      title: `${questionName(item)}: only ${pct(item.p!)} answered correctly`,
      detail: `Check the key${item.multipleCorrect ? ' — on a select-all question, every correct choice has to be marked, so check that each one should be' : ''}. If it is right, the topic may not have been covered.`,
    }),
    (matching) => ({
      title: `${matching.length} questions were answered correctly by under ${pct(NEAR_ZERO_P)}`,
      detail: `${listQuestions(matching)}. Check their keys first.`,
    }),
  )

  perQuestion(
    items.filter((i) => i.negativeDiscrimination && !miskeyed(i)),
    'warning',
    (item) => ({
      title: `${questionName(item)}: stronger students did worse`,
      detail:
        `Discrimination is ${item.discrimination!.toFixed(2)}: students who did well on the rest of the exam were less likely to get this right` +
        (item.upperLower !== null && item.upperLower < 0
          ? ` (the top 27% scored ${Math.abs(item.upperLower * 100).toFixed(0)} points lower on it than the bottom 27%)`
          : '') +
        '. The wording may be ambiguous, or the question may reward a misconception.',
    }),
    (matching) => ({
      title: `${matching.length} questions where stronger students did worse`,
      detail: `${listQuestions(matching)} have negative discrimination. Many at once usually means a scoring problem (a wrong key, or a misaligned import) rather than bad questions.`,
    }),
  )

  // -- variation fairness
  for (const item of items) {
    const test = item.variationTest
    if (!test?.significant) continue
    const sorted = item.variations.filter((v) => v.p !== null).sort((a, b) => (b.p ?? 0) - (a.p ?? 0))
    const easiest = sorted[0]
    const hardest = sorted.at(-1)!
    out.push({
      severity: 'warning',
      question: item.order,
      title: `${questionName(item)}: variation ${hardest.label} was much harder than ${easiest.label}`,
      detail:
        `${sorted.map((v) => `${v.label} ${pct(v.p ?? 0)} correct (n=${v.n})`).join(', ')}; p = ${formatP(test.pValue)}. ` +
        `Variations are drawn at random, so this is the variation, not the students. Students who drew ${hardest.label} lost about ` +
        `${((easiest.p! - hardest.p!) * item.points).toFixed(2)} point${item.points === 1 ? '' : 's'} on average. Consider rewording it before reuse.`,
    })
  }

  if (stats.variationLuck && stats.variationLuck.overOnePoint >= 0.05) {
    const luck = stats.variationLuck
    out.push({
      severity: luck.overOnePoint >= 0.2 ? 'warning' : 'info',
      title: 'Variation draws moved some scores noticeably',
      detail:
        `Based on how hard each variation turned out to be, the luck of the draw shifted students' expected scores by ` +
        `${luck.min.toFixed(1)} to +${luck.max.toFixed(1)} points (SD ${luck.sd.toFixed(2)}). ` +
        `${pct(luck.overOnePoint)} of students were moved by a point or more.`,
    })
  }

  // -- difficulty extremes
  perQuestion(
    items.filter((i) => i.p !== null && i.p >= NEAR_ZERO_P && i.p < HARD_P && !miskeyed(i)),
    'warning',
    (item) => ({
      title: `${questionName(item)} was very hard: ${pct(item.p!)} correct`,
      detail:
        item.discrimination !== null && item.discrimination >= DISCRIMINATION_FAIR
          ? `It still separates stronger from weaker students (discrimination ${item.discrimination.toFixed(2)}), so it may be hard but fair. Check whether the topic was covered.`
          : 'It also does not separate stronger from weaker students, which points to a problem with the question rather than with the class.',
    }),
    (matching) => ({
      title: `${matching.length} questions were answered correctly by under ${pct(HARD_P)}`,
      detail: `${listQuestions(matching)}. Check whether these topics were covered as tested.`,
    }),
  )
  const easy = items.filter((i) => i.p !== null && i.p >= EASY_P)
  if (easy.length) {
    out.push({
      severity: 'info',
      title: `${plural(easy.length, 'question')} answered correctly by ${pct(EASY_P)}+ of students`,
      detail: `${listQuestions(easy)}. These confirm mastery but tell students apart very little; fine in moderation.`,
    })
  }

  // -- weak discrimination
  const weak = items.filter((i) => i.quality === 'weak')
  if (weak.length) {
    out.push({
      severity: 'info',
      title: `${plural(weak.length, 'question')} barely separate stronger from weaker students`,
      detail: `${listQuestions(weak)} have discrimination below ${DISCRIMINATION_FAIR}. Check for ambiguity, guessable answers, or material that was not taught.`,
    })
  }

  // -- response behavior per question
  const overallBlank = stats.responses.total ? stats.responses.blank / stats.responses.total : 0
  perQuestion(
    items.filter(
      (i) => i.n >= MIN_STUDENTS_FOR_ITEMS && i.blankRate * i.n >= 3 && i.blankRate >= 0.08 && i.blankRate >= 2 * overallBlank,
    ),
    'warning',
    (item) => ({
      title: `${questionName(item)} was left blank by ${pct(item.blankRate)}`,
      detail: `Against ${pct(overallBlank, 1)} across the exam. Students may have found it confusing or too long.`,
    }),
    (matching) => ({
      title: `${matching.length} questions were left blank unusually often`,
      detail: `${listQuestions(matching)}, against ${pct(overallBlank, 1)} across the exam.`,
    }),
  )
  perQuestion(
    items.filter((i) => !i.multipleCorrect && i.n >= MIN_STUDENTS_FOR_ITEMS && i.multiRate * i.n >= 3 && i.multiRate >= 0.05),
    'warning',
    (item) => ({
      title: `${questionName(item)} was double-bubbled by ${pct(item.multiRate)}`,
      detail: 'Students may believe two answers are correct. Check whether a distractor is also defensible.',
    }),
    (matching) => ({
      title: `${matching.length} questions were double-bubbled by 5% or more`,
      detail: `${listQuestions(matching)}. Students may believe two answers are correct, or the instructions on marking one answer were unclear.`,
    }),
  )

  // A wrong answer the top of the class prefers to the bottom is often partly right.
  const attractive = new Map<ItemStats, { v: VariationStats; c: ChoiceStats }>()
  for (const item of items) {
    if (item.multipleCorrect || miskeyed(item)) continue
    for (const v of item.variations) {
      const c = v.choices.find(
        (c) =>
          !c.isCorrect &&
          c.rate >= 0.1 &&
          c.upperRate !== null &&
          c.lowerRate !== null &&
          c.upperRate - c.lowerRate >= 0.1,
      )
      if (c && !attractive.has(item)) attractive.set(item, { v, c })
    }
  }
  perQuestion(
    [...attractive.keys()],
    'warning',
    (item) => {
      const { v, c } = attractive.get(item)!
      return {
        title: `${questionName(item)}${item.variations.length > 1 ? ` variation ${v.label}` : ''}: a wrong answer attracts strong students`,
        detail: `${c.label} ("${c.summary}") was chosen by ${pct(c.upperRate!)} of the top 27% but only ${pct(c.lowerRate!)} of the bottom 27%. A distractor that strong students prefer is often partly correct.`,
      }
    },
    (matching) => ({
      title: `${matching.length} questions have a wrong answer that strong students prefer`,
      detail: `${listQuestions(matching)}. A distractor chosen more by the top of the class than the bottom is often partly correct; see each question's choice breakdown.`,
    }),
  )

  const dead = items.flatMap((item) => item.variations.flatMap((v) => v.choices.filter((c) => c.nonFunctional).map(() => item)))
  if (dead.length) {
    const deadItems = [...new Set(dead)]
    out.push({
      severity: 'info',
      title: `${plural(dead.length, 'wrong answer')} chosen by under ${pct(NON_FUNCTIONAL_RATE)} of students`,
      detail: `Across ${listQuestions(deadItems)}. Implausible distractors make a question easier to guess; replacing them makes it more informative.`,
    })
  }

  // -- position on the paper
  const pe = stats.positionEffect
  if (pe) {
    const blankRise = pe.late.blankRate - pe.early.blankRate
    const drop = pe.early.p - pe.late.p
    if (blankRise >= 0.02 && pe.late.blankRate >= 2 * pe.early.blankRate && pe.pValueBlank < SIGNIFICANCE) {
      out.push({
        severity: 'warning',
        title: 'Students may have run out of time',
        detail:
          `Questions at positions ${pe.late.from}–${pe.late.to} were left blank ${pct(pe.late.blankRate, 1)} of the time, ` +
          `against ${pct(pe.early.blankRate, 1)} at positions ${pe.early.from}–${pe.early.to}. Question order is shuffled per student, so this is position, not content.`,
      })
    }
    if (drop >= 0.05 && pe.pValueCorrect < SIGNIFICANCE) {
      out.push({
        severity: 'warning',
        title: 'Scores fell off toward the end of the paper',
        detail:
          `${pct(pe.early.p)} correct at positions ${pe.early.from}–${pe.early.to} against ${pct(pe.late.p)} at ${pe.late.from}–${pe.late.to}. ` +
          `Since every student's question order is shuffled, the same questions were early for some and late for others: this is fatigue or time pressure.`,
      })
    } else if (blankRise < 0.02 && Math.abs(drop) < 0.03) {
      out.push({
        severity: 'good',
        title: 'No sign of time pressure',
        detail: `Questions near the end of the paper were answered as well as those at the start (${pct(pe.late.p)} vs ${pct(pe.early.p)} correct).`,
      })
    }
  }

  // -- whole-exam
  if (stats.reliability && !stats.smallSample) {
    const { alpha, sem } = stats.reliability
    const semPct = stats.possible ? (sem / stats.possible) * 100 : 0
    const detail = `Cronbach's α (KR-20) is ${alpha.toFixed(2)}. The standard error of measurement is ±${sem.toFixed(1)} points (±${semPct.toFixed(1)}%): a student's observed score is within that of their "true" score about two times in three.`
    if (alpha >= 0.8) out.push({ severity: 'good', title: 'The exam measured consistently', detail })
    else if (alpha >= 0.7) out.push({ severity: 'info', title: 'Reliability is acceptable', detail })
    else
      out.push({
        severity: 'warning',
        title: 'Reliability is low',
        detail: `${detail} Questions flagged as weak or for review are the place to start.`,
      })
  }

  if (percent.mean < 60) {
    out.push({
      severity: 'warning',
      title: `The class averaged ${percent.mean.toFixed(1)}%`,
      detail: `Median ${percent.median.toFixed(1)}%. ${plural(stats.bands.find((b) => b.grade === 'F')?.count ?? 0, 'student')} scored below 60%.`,
    })
  }
  const ceiling = counts.graded ? stats.bands.find((b) => b.grade === 'A')!.count / counts.graded : 0
  if (ceiling >= 0.4) {
    out.push({
      severity: 'info',
      title: `${pct(ceiling)} of students scored 90% or higher`,
      detail: 'The exam may not have separated the top of the class well.',
    })
  }

  // -- groups
  for (const group of stats.sections) {
    if (group.n < MIN_GROUP || group.diff === null || group.pValue === null) continue
    if (Math.abs(group.diff) >= 5 && group.pValue < SIGNIFICANCE) {
      out.push({
        severity: 'info',
        title: `Section ${group.label} scored ${Math.abs(group.diff).toFixed(1)} points ${group.diff > 0 ? 'above' : 'below'} the rest of the class`,
        detail: `Mean ${group.mean!.toFixed(1)}% across ${plural(group.n, 'student')} (p = ${formatP(group.pValue)}).`,
      })
    }
  }
  const trend = stats.sessionTrend
  if (trend && trend.r > 0 && trend.pValue < SIGNIFICANCE && trend.lastMean - trend.firstMean >= 3) {
    out.push({
      severity: 'warning',
      title: 'Later sessions scored higher',
      detail:
        `Mean score rose from ${trend.firstMean.toFixed(1)}% in the first session to ${trend.lastMean.toFixed(1)}% in the last ` +
        `(r = ${trend.r.toFixed(2)}, p = ${formatP(trend.pValue)}). That is the pattern content passed between sittings leaves; ` +
        `per-student variations limit the damage, but it is worth a look at the sessions below.`,
    })
  } else {
    for (const group of stats.sessions) {
      if (group.n < MIN_GROUP || group.diff === null || group.pValue === null) continue
      if (Math.abs(group.diff) >= 5 && group.pValue < SIGNIFICANCE) {
        out.push({
          severity: 'info',
          title: `${group.label} scored ${Math.abs(group.diff).toFixed(1)} points ${group.diff > 0 ? 'above' : 'below'} everyone else`,
          detail: `Mean ${group.mean!.toFixed(1)}% across ${plural(group.n, 'student')} (p = ${formatP(group.pValue)}).`,
        })
      }
    }
  }

  if (stats.extraCredit && counts.graded) {
    const ec = stats.extraCredit
    out.push({
      severity: 'info',
      title: `${pct(ec.earned / counts.graded)} earned the extra-credit point`,
      detail: `${plural(ec.attempted, 'student')} bubbled row ${ec.position}; ${ec.earned} had the right combination. Without the bonus the class would have averaged ${ec.meanWithout?.toFixed(1)}%.`,
    })
  }

  if (counts.notTaken > 0) {
    out.push({
      severity: 'info',
      title: `${plural(counts.notTaken, 'student')} had no scanned sheet`,
      detail: 'They are excluded from every statistic here.',
    })
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

export function formatP(p: number): string {
  if (p < 0.001) return '< 0.001'
  return p.toFixed(3)
}
