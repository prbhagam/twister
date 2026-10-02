'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { executeRun } from '@/lib/generation'
import {
  checkPositionCoverage,
  gradeStudent,
  matchStudents,
  parseGradescopeCsv,
} from '@/lib/grading'
import { answeredLayout, formatBlankLabel, parseBlankLabel } from '@/lib/blank-exams'
import { readExtraCredit } from '@/lib/extra-credit'
import { audit } from '@/lib/audit'
import { requireRunPermission } from '@/lib/authorization'
import { postCanvasGrade } from '@/lib/canvas'
import { MISSING_MARK } from '@/lib/export'

export interface GradingPreviewState {
  ok?: boolean
  error?: string
  filename?: string
  csvText?: string
  positions?: number
  matched?: number
  csvOnly?: { studentId: string; name: string }[]
  rosterOnly?: { studentId: string; name: string }[]
  missingStatus?: number
}

async function runStudents(runId: string) {
  const studentExams = await prisma.studentExam.findMany({
    where: { runId },
    include: { student: true },
  })
  return studentExams.map((se) => ({
    studentExamId: se.id,
    gtId: se.student.gtId,
    firstName: se.student.firstName,
    lastName: se.student.lastName,
    email: se.student.email,
  }))
}

/**
 * Parses and matches a Gradescope export without writing anything, so mismatches
 * are visible before they become scores.
 */
export async function previewGrading(
  _prev: GradingPreviewState,
  formData: FormData,
): Promise<GradingPreviewState> {
  const runId = String(formData.get('runId'))
  const { run } = await requireRunPermission(runId, 'grade:write')
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a Gradescope CSV to upload.' }

  const csvText = await file.text()
  const parsed = parseGradescopeCsv(csvText)
  if (parsed.errors.length) return { error: parsed.errors.join(' ') }

  const questionCount = await prisma.runQuestion.count({ where: { runId } })
  // The bonus row sits past the exam's own questions, so the export legitimately
  // carries more columns than the run has questions. See checkPositionCoverage.
  const coverageError = checkPositionCoverage(parsed.positions, questionCount, run.extraCreditPosition)
  if (coverageError) return { error: coverageError }

  const report = matchStudents(parsed.rows, await runStudents(runId))

  return {
    ok: true,
    filename: file.name,
    csvText,
    positions: parsed.positions.length,
    matched: report.matched.length,
    csvOnly: report.csvOnly,
    rosterOnly: report.rosterOnly,
    missingStatus: report.missingStatus,
  }
}

export interface GradingCommitState {
  ok?: boolean
  error?: string
  graded?: number
}

/** Writes the scores. Any previous import for this run is deactivated, not deleted. */
export async function commitGrading(
  _prev: GradingCommitState,
  formData: FormData,
): Promise<GradingCommitState> {
  const runId = String(formData.get('runId'))
  const { user, run } = await requireRunPermission(runId, 'grade:write')
  const filename = String(formData.get('filename') ?? 'gradescope.csv')
  const csvText = String(formData.get('csvText') ?? '')
  if (!csvText) return { error: 'Nothing to import — upload the CSV again.' }

  const parsed = parseGradescopeCsv(csvText)
  if (parsed.errors.length) return { error: parsed.errors.join(' ') }

  const studentExams = await prisma.studentExam.findMany({
    where: { runId },
    include: { student: true, overrides: true, blankExam: true },
  })
  const report = matchStudents(
    parsed.rows,
    studentExams.map((se) => ({
      studentExamId: se.id,
      gtId: se.student.gtId,
      firstName: se.student.firstName,
      lastName: se.student.lastName,
      email: se.student.email,
    })),
  )

  const byId = new Map(studentExams.map((se) => [se.id, se]))

  await prisma.gradingImport.updateMany({ where: { runId }, data: { isActive: false } })
  const record = await prisma.gradingImport.create({
    data: {
      runId,
      filename,
      matched: report.matched.length,
      unmatched: JSON.stringify({
        csvOnly: report.csvOnly,
        rosterOnly: report.rosterOnly,
        missingStatus: report.missingStatus,
      }),
      isActive: true,
      uploadedById: user.id,
    },
  })

  let graded = 0
  for (const { studentExamId, row } of report.matched) {
    const studentExam = byId.get(studentExamId)
    if (!studentExam) continue

    const result = gradeStudent({
      // The blank they wrote on, for a student who sat a different session;
      // matching still went through their own GT ID, which they bubbled in.
      layout: answeredLayout(studentExam),
      responses: row.responses,
      status: row.status,
      // Read off the run, not the exam: a combination edited since this run was
      // generated must not regrade papers printed against the old one.
      extraCredit: readExtraCredit(run),
      // Overrides live on the StudentExam, so they survive re-importing a
      // corrected CSV rather than being wiped by it.
      overrides: new Map(
        studentExam.overrides.map((o) => [o.position, { awarded: o.awarded, note: o.note }]),
      ),
    })

    await prisma.studentResult.create({
      data: {
        importId: record.id,
        studentExamId,
        status: result.status,
        earned: result.earned,
        possible: result.possible,
        questions: {
          create: result.questions.map((q) => ({
            position: q.position,
            rawResponse: q.rawResponse,
            letters: JSON.stringify(q.letters),
            verdict: q.verdict,
            awarded: q.awarded,
            possible: q.possible,
          })),
        },
      },
    })
    graded++
  }

  revalidatePath(`/runs/${runId}`)
  await audit({ actorUserId: user.id, action: 'gradescope.imported', entityType: 'grading_import', entityId: record.id, courseId: (await prisma.exam.findUniqueOrThrow({ where: { id: run.examId } })).courseId, metadata: { matched: graded } })
  return { ok: true, graded }
}

/**
 * Sets or clears a manual score for one question on one student's exam, then
 * recomputes that student's total in the active import.
 */
export async function setOverride(formData: FormData) {
  const studentExamId = String(formData.get('studentExamId'))
  const position = Number(formData.get('position'))
  const clear = formData.get('clear') === '1'
  const runId = String(formData.get('runId'))
  const { user, run } = await requireRunPermission(runId, 'grade:write')

  if (clear) {
    await prisma.override.deleteMany({ where: { studentExamId, position } })
  } else {
    const awarded = Number(formData.get('awarded'))
    const note = String(formData.get('note') ?? '').trim() || null
    await prisma.override.upsert({
      where: { studentExamId_position: { studentExamId, position } },
      create: { studentExamId, position, awarded, note, createdById: user.id },
      update: { awarded, note, createdById: user.id },
    })
  }

  const active = await prisma.gradingImport.findFirst({ where: { runId, isActive: true } })
  if (active) {
    const result = await prisma.studentResult.findUnique({
      where: { importId_studentExamId: { importId: active.id, studentExamId } },
      include: { questions: true },
    })
    const overrides = await prisma.override.findMany({ where: { studentExamId } })

    if (result) {
      const overrideByPosition = new Map(overrides.map((o) => [o.position, o.awarded]))
      let earned = 0
      for (const question of result.questions) {
        const awarded =
          overrideByPosition.get(question.position) ??
          (question.verdict === 'correct' ? question.possible : 0)
        earned += awarded
        await prisma.questionResult.update({ where: { id: question.id }, data: { awarded } })
      }
      await prisma.studentResult.update({ where: { id: result.id }, data: { earned } })
    }
  }

  revalidatePath(`/runs/${runId}/students/${studentExamId}`)
  revalidatePath(`/runs/${runId}`)
  await audit({ actorUserId: user.id, action: 'grading.manual_override', entityType: 'student_exam', entityId: studentExamId, courseId: (await prisma.exam.findUniqueOrThrow({ where: { id: run.examId } })).courseId, metadata: { position, clear } })
}

/**
 * Regrades one student in the active import from the responses already stored
 * for them, against whichever paper they are now recorded as having used. Only
 * a graded result is touched: a student Gradescope reported Missing has no
 * responses to regrade.
 */
async function regradeFromStoredResponses(runId: string, studentExamId: string): Promise<void> {
  const active = await prisma.gradingImport.findFirst({ where: { runId, isActive: true } })
  if (!active) return
  const run = await prisma.generationRun.findUniqueOrThrow({ where: { id: runId } })
  const result = await prisma.studentResult.findUnique({
    where: { importId_studentExamId: { importId: active.id, studentExamId } },
    include: { questions: true },
  })
  if (!result || result.status !== 'graded') return

  const studentExam = await prisma.studentExam.findUniqueOrThrow({
    where: { id: studentExamId },
    include: { overrides: true, blankExam: true },
  })
  const regraded = gradeStudent({
    layout: answeredLayout(studentExam),
    responses: new Map(result.questions.map((q) => [q.position, q.rawResponse])),
    status: result.status,
    extraCredit: readExtraCredit(run),
    overrides: new Map(
      studentExam.overrides.map((o) => [o.position, { awarded: o.awarded, note: o.note }]),
    ),
  })

  await prisma.$transaction([
    prisma.questionResult.deleteMany({ where: { resultId: result.id } }),
    prisma.studentResult.update({
      where: { id: result.id },
      data: {
        earned: regraded.earned,
        possible: regraded.possible,
        questions: {
          create: regraded.questions.map((q) => ({
            position: q.position,
            rawResponse: q.rawResponse,
            letters: JSON.stringify(q.letters),
            verdict: q.verdict,
            awarded: q.awarded,
            possible: q.possible,
          })),
        },
      },
    }),
  ])
}

export interface BlankAssignState {
  ok?: boolean
  error?: string
  message?: string
}

/**
 * Records that a student sat a session they did not sign up for, on one of
 * that session's blank exams, and regrades them against it at once.
 *
 * Their overrides are cleared: each was entered against a question position on
 * their own paper, and position 4 on the blank is a different question.
 */
export async function assignBlankExam(
  _prev: BlankAssignState,
  formData: FormData,
): Promise<BlankAssignState> {
  const runId = String(formData.get('runId'))
  const { user, run } = await requireRunPermission(runId, 'grade:write')
  const studentExamId = String(formData.get('studentExamId') ?? '')
  const typed = String(formData.get('blank') ?? '')

  const studentExam = await prisma.studentExam.findUnique({
    where: { id: studentExamId },
    include: { student: true, blankExam: true },
  })
  if (!studentExam || studentExam.runId !== runId) return { error: 'Choose a student from this run.' }

  const number = parseBlankLabel(typed)
  if (number === null) return { error: `"${typed.trim()}" is not a blank exam ID. Enter it as printed, e.g. ${formatBlankLabel(7)}.` }
  const label = formatBlankLabel(number)

  const blank = await prisma.blankExam.findUnique({
    where: { examId_number: { examId: run.examId, number } },
    include: { usedBy: { include: { student: true } } },
  })
  if (!blank) return { error: `No blank exam ${label} has been issued for this exam.` }
  if (blank.runId !== runId) return { error: `${label} belongs to a different run of this exam.` }

  const name = `${studentExam.student.firstName} ${studentExam.student.lastName}`
  if (blank.usedBy?.id === studentExamId) return { ok: true, message: `${name} is already recorded on ${label}.` }
  if (blank.usedBy) {
    const other = blank.usedBy.student
    return { error: `${label} is already recorded for ${other.firstName} ${other.lastName}. Remove that first if it was a mistake.` }
  }

  const [cleared] = await prisma.$transaction([
    prisma.override.deleteMany({ where: { studentExamId } }),
    prisma.studentExam.update({ where: { id: studentExamId }, data: { blankExamId: blank.id } }),
  ])
  await regradeFromStoredResponses(runId, studentExamId)

  revalidatePath(`/runs/${runId}`)
  revalidatePath(`/runs/${runId}/students/${studentExamId}`)
  await audit({
    actorUserId: user.id,
    action: 'grading.blank_exam_assigned',
    entityType: 'student_exam',
    entityId: studentExamId,
    courseId: (await prisma.exam.findUniqueOrThrow({ where: { id: run.examId } })).courseId,
    metadata: { blankExamId: blank.id, label, replaced: studentExam.blankExamId, clearedOverrides: cleared.count },
  })

  const overrideNote = cleared.count > 0 ? ` Cleared ${cleared.count} manual override${cleared.count === 1 ? '' : 's'}.` : ''
  return { ok: true, message: `${name} now grades against ${label}.${overrideNote}` }
}

/** Undoes assignBlankExam: the student grades against their own paper again. */
export async function clearBlankExam(formData: FormData) {
  const runId = String(formData.get('runId'))
  const studentExamId = String(formData.get('studentExamId'))
  const { user, run } = await requireRunPermission(runId, 'grade:write')

  const studentExam = await prisma.studentExam.findUnique({ where: { id: studentExamId } })
  if (!studentExam || studentExam.runId !== runId || !studentExam.blankExamId) return

  // Same reason as assigning: the overrides were entered against the blank's
  // question order, which no longer applies.
  await prisma.$transaction([
    prisma.override.deleteMany({ where: { studentExamId } }),
    prisma.studentExam.update({ where: { id: studentExamId }, data: { blankExamId: null } }),
  ])
  await regradeFromStoredResponses(runId, studentExamId)

  revalidatePath(`/runs/${runId}`)
  revalidatePath(`/runs/${runId}/students/${studentExamId}`)
  await audit({
    actorUserId: user.id,
    action: 'grading.blank_exam_cleared',
    entityType: 'student_exam',
    entityId: studentExamId,
    courseId: (await prisma.exam.findUniqueOrThrow({ where: { id: run.examId } })).courseId,
    metadata: { blankExamId: studentExam.blankExamId },
  })
}

/** Re-renders every PDF for a run — used after a failed or interrupted run. */
export async function retryRun(formData: FormData) {
  const runId = String(formData.get('runId'))
  await requireRunPermission(runId, 'exam:generate')
  void executeRun(runId).catch((error) => {
    console.error(`[twister] generation run ${runId} failed:`, error)
  })
  revalidatePath(`/runs/${runId}`)
}

export interface CanvasSyncState {
  ok?: boolean
  error?: string
  synced?: number
  /** Students Canvas refused, most likely the ones sent MISSING_MARK. */
  failed?: { name: string; grade: string; reason: string }[]
  /** Graded students with no Canvas user mapped; unreachable either way. */
  unmapped?: number
}

/** Posts the active, final grading import to one Canvas assignment. The typed
 * confirmation ensures a browser click cannot silently change student records. */
export async function syncCanvasGrades(_prev: CanvasSyncState, formData: FormData): Promise<CanvasSyncState> {
  const runId = String(formData.get('runId'))
  const assignmentId = String(formData.get('assignmentId') ?? '').trim()
  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const submittedOnly = formData.get('submittedOnly') === 'on'
  const { user, run } = await requireRunPermission(runId, 'export:grades')
  if (!/^\d+$/.test(assignmentId)) return { error: 'Enter the numeric Canvas assignment ID.' }
  if (confirmation !== 'PUSH') return { error: 'Type PUSH to confirm posting grades to Canvas.' }

  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: run.examId }, include: { course: true } })
  if (!exam.course.canvasCourseId) return { error: 'Import the Canvas roster for this course before syncing grades.' }
  const activeImport = await prisma.gradingImport.findFirst({ where: { runId, isActive: true }, orderBy: { createdAt: 'desc' } })
  if (!activeImport) return { error: 'Grade the run before syncing to Canvas.' }
  const results = await prisma.studentResult.findMany({ where: { importId: activeImport.id }, include: { studentExam: { include: { student: true } } } })
  const mapped = results.filter((result) => result.studentExam.student.canvasUserId)
  const unmapped = results.filter(
    (result) => result.status === 'graded' && !result.studentExam.student.canvasUserId,
  ).length

  // Unchecked, the sync covers the whole roster and records MISSING_MARK for anyone
  // without a scanned sheet. Checked, it touches only students who sat the exam,
  // leaving everyone else's Canvas grade exactly as it is.
  const eligible = mapped
    .filter((result) => !submittedOnly || result.status === 'graded')
    .map((result) => ({
      result,
      grade: result.status === 'graded' ? result.earned : (MISSING_MARK as number | string),
    }))
  if (!eligible.length) return { error: 'There are no Canvas-mapped results to sync.' }

  const failed: NonNullable<CanvasSyncState['failed']> = []
  let synced = 0
  let consecutiveFailures = 0

  for (const { result, grade } of eligible) {
    const student = result.studentExam.student
    const name = `${student.lastName}, ${student.firstName}`
    try {
      await postCanvasGrade({
        courseId: exam.course.canvasCourseId,
        assignmentId,
        studentCanvasUserId: student.canvasUserId!,
        grade,
      })
      synced++
      consecutiveFailures = 0
    } catch (error) {
      failed.push({ name, grade: String(grade), reason: error instanceof Error ? error.message : 'Canvas rejected the grade.' })
      consecutiveFailures++
      // A run of failures means something systemic — a bad token, the wrong
      // assignment — not one awkward student. Stop rather than issue hundreds of
      // doomed requests.
      if (consecutiveFailures >= 5) {
        return {
          error: `Stopped after ${consecutiveFailures} consecutive failures. ${synced} grade(s) were posted before that; review Canvas before retrying.`,
          synced,
          failed: failed.slice(0, 20),
          unmapped,
        }
      }
    }
  }

  await audit({ actorUserId: user.id, action: 'canvas.grades_synced', entityType: 'generation_run', entityId: runId, courseId: exam.courseId, metadata: { assignmentId, count: synced, failed: failed.length, submittedOnly } })
  return { ok: true, synced, failed: failed.slice(0, 20), unmapped }
}
