import { createHmac } from 'node:crypto'

export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const
export const MAX_CHOICES = LETTERS.length

// --- primitives --------------------------------------------------------------

function hmac(key: string, message: string): Buffer {
  return createHmac('sha256', key).update(message).digest()
}

/**
 * sfc32 — small, fast, and (unlike Math.random) reproducible across processes and
 * platforms, which is the whole point: the same student must get the same paper if
 * you regenerate a lost printout six weeks later.
 */
export function sfc32(seed: Buffer): () => number {
  let a = seed.readUInt32LE(0)
  let b = seed.readUInt32LE(4)
  let c = seed.readUInt32LE(8)
  let d = seed.readUInt32LE(12)

  const next = () => {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }

  // Discard the first outputs: sfc32 needs a few rounds before the state is fully
  // mixed, otherwise near-identical seeds can produce correlated first draws.
  for (let i = 0; i < 12; i++) next()
  return next
}

export function randomInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n)
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// --- seed derivation ---------------------------------------------------------

/** Root seed for one student on one exam. Everything else derives from this. */
export function studentSeed(instructorSeed: string, examId: string, gtId: string): Buffer {
  return hmac(instructorSeed, `${examId}:${String(gtId).trim()}`)
}

/**
 * Per-question sub-stream. Deriving a fresh stream per question (rather than
 * pulling from one long stream) means editing question 7 does not reshuffle
 * questions 1-6, which keeps regenerated runs diffable.
 */
function questionSeed(root: Buffer, questionKey: string): Buffer {
  return hmac(root.toString('hex'), `q:${questionKey}`)
}

function orderSeed(root: Buffer): Buffer {
  return hmac(root.toString('hex'), 'order')
}

/** Short human-quotable id printed in the exam footer for tracing a physical paper. */
export function traceCodeFor(root: Buffer): string {
  return root.toString('hex').slice(0, 6).toUpperCase()
}

// --- layout construction -----------------------------------------------------

export interface SeedChoice {
  /** RunChoice.id — recorded into the layout. */
  refId: string
  isCorrect: boolean
  pinToLast: boolean
}

export interface SeedVariation {
  refId: string
  choices: SeedChoice[]
}

export interface SeedQuestion {
  /**
   * Stable identity across runs — always the *authoring* Question.id, never the
   * RunQuestion.id (which is a fresh cuid per run and would break reproducibility).
   */
  key: string
  refId: string
  points: number
  /** In author order; the variation is picked by index, so ids may change freely. */
  variations: SeedVariation[]
}

export interface LayoutEntry {
  /** 1-based position on the bubble sheet. */
  position: number
  runQuestionId: string
  runVariationId: string
  /** choiceOrder[0] is printed as A, [1] as B, and so on. */
  choiceOrder: string[]
  correctLetter: string | null
  choiceCount: number
  points: number
}

export interface ExamLayout {
  traceCode: string
  entries: LayoutEntry[]
}

/**
 * Deterministically lay out one student's exam.
 *
 * Draw order is fixed and must not be reordered — doing so would silently change
 * every already-printed exam:
 *   1. pick a variation per question   (per-question stream)
 *   2. permute that variation's choices (same per-question stream)
 *   3. permute the question order       (order stream)
 */
export function buildLayout(params: {
  instructorSeed: string
  examId: string
  gtId: string
  questions: SeedQuestion[]
  /**
   * Skips the random per-question variation draw and uses this index on every
   * question instead. Only for practice exams, where every question is required to
   * have the same number of variations, so "variant A" means index 0 everywhere.
   * Choice and question-order shuffling still run as normal.
   */
  forcedVariantIndex?: number
}): ExamLayout {
  const { instructorSeed, examId, gtId, questions, forcedVariantIndex } = params
  const root = studentSeed(instructorSeed, examId, gtId)

  const drawn = questions.map((question) => {
    const rng = sfc32(questionSeed(root, question.key))

    const variation =
      forcedVariantIndex !== undefined
        ? question.variations[forcedVariantIndex]
        : question.variations[randomInt(rng, question.variations.length)]

    // Pinned choices ("None of the above") are held out of the permutation and
    // appended in author order, so they always land in the last slot(s).
    const free = variation.choices.filter((c) => !c.pinToLast)
    const pinned = variation.choices.filter((c) => c.pinToLast)
    const ordered = [...shuffle(free, rng), ...pinned]

    const correctIndex = ordered.findIndex((c) => c.isCorrect)

    return {
      runQuestionId: question.refId,
      runVariationId: variation.refId,
      choiceOrder: ordered.map((c) => c.refId),
      correctLetter: correctIndex >= 0 ? (LETTERS[correctIndex] ?? null) : null,
      choiceCount: ordered.length,
      points: question.points,
    }
  })

  const order = shuffle(drawn, sfc32(orderSeed(root)))

  return {
    traceCode: traceCodeFor(root),
    entries: order.map((entry, i) => ({ position: i + 1, ...entry })),
  }
}

// --- reporting ---------------------------------------------------------------

function factorial(n: number): bigint {
  let out = 1n
  for (let i = 2n; i <= BigInt(n); i++) out *= i
  return out
}

/**
 * Total number of distinct papers the exam can produce:
 *   (product over questions of variations x choice-permutations) x question-orders
 *
 * Surfaced in the UI because it is the whole justification for the system.
 */
export function distinctExamCount(
  questions: { variations: { choices: { pinToLast: boolean }[] }[] }[],
): bigint {
  if (questions.length === 0) return 0n

  let total = 1n
  for (const q of questions) {
    let perQuestion = 0n
    for (const v of q.variations) {
      // Pinned choices do not permute.
      perQuestion += factorial(v.choices.filter((c) => !c.pinToLast).length)
    }
    total *= perQuestion
  }
  return total * factorial(questions.length)
}

/** "2.3 x 10^39" — big integers are unreadable at this scale. */
export function formatBig(n: bigint): string {
  if (n === 0n) return '0'
  const s = n.toString()
  if (s.length <= 6) return s
  const mantissa = `${s[0]}.${s.slice(1, 3)}`
  return `${mantissa} × 10^${s.length - 1}`
}
