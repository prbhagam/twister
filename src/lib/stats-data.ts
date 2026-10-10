import { answeredLayout } from './blank-exams'
import { prisma } from './db'
import { readExtraCredit } from './extra-credit'
import type { Verdict } from './grading'
import { toPlainSummary } from './markdown'
import { sectionLabel } from './roster'
import { LETTERS } from './seed'
import { computeExamStats, type ExamStats, type StatsGroupRef, type StatsStudent } from './stats'

export interface RunStats {
  stats: ExamStats
  examTitle: string
  courseName: string
  runLabel: string
  /** The Gradescope export the numbers came from, or null when nothing is graded. */
  filename: string | null
  importedAt: Date | null
}

/**
 * Loads one run's active grading import into `computeExamStats`.
 *
 * Reads the same sources as the score pages — the run snapshot, each student's
 * answered layout (a blank exam's when they sat one), and the stored question
 * results, whose `awarded` already reflects manual overrides — so the numbers
 * here always agree with the gradebook export.
 */
export async function loadRunStats(runId: string): Promise<RunStats> {
  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      exam: { include: { course: true } },
      questions: { include: { variations: { include: { choices: true } } } },
    },
  })

  const activeImport = await prisma.gradingImport.findFirst({
    where: { runId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })

  const studentExams = await prisma.studentExam.findMany({
    where: { runId },
    include: { student: true, blankExam: true, overrides: true },
  })

  const results = activeImport
    ? await prisma.studentResult.findMany({
        where: { importId: activeImport.id },
        include: { questions: true },
      })
    : []
  const resultByStudentExam = new Map(results.map((r) => [r.studentExamId, r]))

  // Sign-ups belong to the exam, not the run; a student with no row simply has
  // no session.
  const signups = await prisma.signupRow.findMany({
    where: { examId: run.examId },
    include: { bucket: true },
  })
  const sessionByStudent = new Map<string, StatsGroupRef>(
    signups.map((row) => [
      row.studentId,
      {
        key: row.bucket.id,
        label: row.bucket.label ?? row.bucket.rawLabel,
        at: row.bucket.sessionAt,
        kind: row.bucket.kind as StatsGroupRef['kind'],
      },
    ]),
  )

  const extraCredit = readExtraCredit(run)

  const students: StatsStudent[] = studentExams.map((se) => {
    const sections = (JSON.parse(se.student.sections) as string[]).map((code) => ({
      key: code,
      label: sectionLabel(code),
    }))
    const session = sessionByStudent.get(se.studentId) ?? null
    const layout = answeredLayout(se)
    const result = resultByStudentExam.get(se.id)

    if (!result || result.status !== 'graded') {
      return {
        status: result?.status ?? 'not_taken',
        earned: 0,
        possible: layout.reduce((sum, e) => sum + e.points, 0),
        sections,
        session,
        responses: [],
        extraCredit: null,
      }
    }

    const overridden = new Set(se.overrides.map((o) => o.position))
    const byPosition = new Map(result.questions.map((q) => [q.position, q]))
    const responses = layout.flatMap((entry) => {
      const q = byPosition.get(entry.position)
      if (!q) return []
      return [
        {
          position: entry.position,
          runQuestionId: entry.runQuestionId,
          runVariationId: entry.runVariationId,
          choiceOrder: entry.choiceOrder,
          letters: JSON.parse(q.letters) as string[],
          verdict: q.verdict as Verdict,
          awarded: q.awarded,
          possible: q.possible,
          overridden: overridden.has(entry.position),
        },
      ]
    })

    const bonus = extraCredit ? byPosition.get(extraCredit.position) : undefined
    return {
      status: 'graded',
      earned: result.earned,
      possible: result.possible,
      sections,
      session,
      responses,
      extraCredit: bonus
        ? { marked: (JSON.parse(bonus.letters) as string[]).length > 0, correct: bonus.awarded > 0 }
        : extraCredit
          ? { marked: false, correct: false }
          : null,
    }
  })

  const stats = computeExamStats({
    extraCreditPosition: extraCredit?.position ?? null,
    students,
    questions: run.questions.map((question) => ({
      id: question.id,
      order: question.order,
      title: question.title,
      points: question.points,
      variations: question.variations
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((variation) => ({
          id: variation.id,
          label: variation.label,
          summary: toPlainSummary(variation.promptMarkdown, 140),
          choices: variation.choices
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((choice) => ({
              id: choice.id,
              label: LETTERS[choice.order] ?? String(choice.order + 1),
              summary: toPlainSummary(choice.textMarkdown, 70),
              isCorrect: choice.isCorrect,
              pinToLast: choice.pinToLast,
            })),
        })),
    })),
  })

  return {
    stats,
    // Runs created before the cover snapshot existed carry empty strings here.
    examTitle: run.examTitle || run.exam.title,
    courseName: run.courseName || run.exam.course.name,
    runLabel: run.label ?? `Run of ${run.createdAt.toLocaleString()}`,
    filename: activeImport?.filename ?? null,
    importedAt: activeImport?.createdAt ?? null,
  }
}
