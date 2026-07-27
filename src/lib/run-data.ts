import { prisma } from './db'
import type { GradedQuestion, Verdict } from './grading'
import type { ExportStudent, ScoreRow } from './export'
import type { LayoutEntry } from './seed'

/**
 * Assembles the score rows for a run's active grading import.
 *
 * Students with no scanned sheet are included with status `not_taken` so exports
 * account for the whole roster rather than silently dropping absentees.
 */
export async function loadScoreRows(runId: string): Promise<{
  rows: ScoreRow[]
  importId: string | null
  filename: string | null
}> {
  const activeImport = await prisma.gradingImport.findFirst({
    where: { runId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })

  const studentExams = await prisma.studentExam.findMany({
    where: { runId },
    include: { student: true, overrides: true },
  })

  // Fetched separately rather than as a conditional `include`, which would make the
  // row type a union and lose `questions` entirely.
  const results = activeImport
    ? await prisma.studentResult.findMany({
        where: { importId: activeImport.id },
        include: { questions: true },
      })
    : []
  const resultByStudentExam = new Map(results.map((r) => [r.studentExamId, r]))

  const rows: ScoreRow[] = studentExams.map((se) => {
    const layout = JSON.parse(se.layout) as LayoutEntry[]
    const student: ExportStudent = {
      firstName: se.student.firstName,
      lastName: se.student.lastName,
      gtId: se.student.gtId,
      username: se.student.username,
      email: se.student.email,
      sections: JSON.parse(se.student.sections) as string[],
      traceCode: se.traceCode,
    }

    const result = resultByStudentExam.get(se.id)
    if (!result) {
      return {
        student,
        status: 'not_taken',
        earned: 0,
        possible: layout.reduce((sum, e) => sum + e.points, 0),
        questions: [],
      }
    }

    const overrides = new Map(se.overrides.map((o) => [o.position, o]))
    const byPosition = new Map(layout.map((e) => [e.position, e]))

    const questions: GradedQuestion[] = result.questions
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((q) => {
        const override = overrides.get(q.position)
        return {
          position: q.position,
          rawResponse: q.rawResponse,
          letters: JSON.parse(q.letters) as string[],
          verdict: q.verdict as Verdict,
          awarded: q.awarded,
          possible: q.possible,
          correctLetter: byPosition.get(q.position)?.correctLetter ?? null,
          overridden: Boolean(override),
          overrideNote: override?.note ?? undefined,
        }
      })

    return {
      student,
      status: result.status,
      earned: result.earned,
      possible: result.possible,
      questions,
    }
  })

  return {
    rows,
    importId: activeImport?.id ?? null,
    filename: activeImport?.filename ?? null,
  }
}

/** Human labels for the answer key: run question id -> "7", run variation id -> "B". */
export async function loadLabelMaps(runId: string): Promise<{
  questionLabels: Map<string, string>
  variationLabels: Map<string, string>
}> {
  const questions = await prisma.runQuestion.findMany({
    where: { runId },
    include: { variations: true },
  })

  const questionLabels = new Map<string, string>()
  const variationLabels = new Map<string, string>()
  for (const question of questions) {
    questionLabels.set(question.id, String(question.order))
    for (const variation of question.variations) {
      variationLabels.set(variation.id, variation.label)
    }
  }

  return { questionLabels, variationLabels }
}
