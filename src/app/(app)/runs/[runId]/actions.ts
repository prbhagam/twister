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
import type { LayoutEntry } from '@/lib/seed'
import { audit } from '@/lib/audit'
import { requireRunPermission } from '@/lib/authorization'
import { postCanvasGrade } from '@/lib/canvas'

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
  await requireRunPermission(runId, 'grade:write')
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a Gradescope CSV to upload.' }

  const csvText = await file.text()
  const parsed = parseGradescopeCsv(csvText)
  if (parsed.errors.length) return { error: parsed.errors.join(' ') }

  const questionCount = await prisma.runQuestion.count({ where: { runId } })
  const coverageError = checkPositionCoverage(parsed.positions, questionCount)
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
    include: { student: true, overrides: true },
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
      layout: JSON.parse(studentExam.layout) as LayoutEntry[],
      responses: row.responses,
      status: row.status,
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

/** Re-renders every PDF for a run — used after a failed or interrupted run. */
export async function retryRun(formData: FormData) {
  const runId = String(formData.get('runId'))
  await requireRunPermission(runId, 'exam:generate')
  void executeRun(runId).catch((error) => {
    console.error(`[twister] generation run ${runId} failed:`, error)
  })
  revalidatePath(`/runs/${runId}`)
}

export interface CanvasSyncState { ok?: boolean; error?: string; synced?: number }

/** Posts the active, final grading import to one Canvas assignment. The typed
 * confirmation ensures a browser click cannot silently change student records. */
export async function syncCanvasGrades(_prev: CanvasSyncState, formData: FormData): Promise<CanvasSyncState> {
  const runId = String(formData.get('runId'))
  const assignmentId = String(formData.get('assignmentId') ?? '').trim()
  const confirmation = String(formData.get('confirmation') ?? '').trim()
  const { user, run } = await requireRunPermission(runId, 'export:grades')
  if (!/^\d+$/.test(assignmentId)) return { error: 'Enter the numeric Canvas assignment ID.' }
  if (confirmation !== 'PUSH') return { error: 'Type PUSH to confirm posting grades to Canvas.' }

  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: run.examId }, include: { course: true } })
  if (!exam.course.canvasCourseId) return { error: 'Import the Canvas roster for this course before syncing grades.' }
  const activeImport = await prisma.gradingImport.findFirst({ where: { runId, isActive: true }, orderBy: { createdAt: 'desc' } })
  if (!activeImport) return { error: 'Grade the run before syncing to Canvas.' }
  const results = await prisma.studentResult.findMany({ where: { importId: activeImport.id }, include: { studentExam: { include: { student: true } } } })
  const eligible = results.filter((result) => result.status === 'graded' && result.studentExam.student.canvasUserId)
  if (!eligible.length) return { error: 'There are no graded Canvas-mapped results to sync.' }

  try {
    for (const result of eligible) {
      await postCanvasGrade({
        courseId: exam.course.canvasCourseId,
        assignmentId,
        studentCanvasUserId: result.studentExam.student.canvasUserId!,
        grade: result.earned,
      })
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Canvas grade sync failed. Some grades may have been posted; review Canvas before retrying.' }
  }
  await audit({ actorUserId: user.id, action: 'canvas.grades_synced', entityType: 'generation_run', entityId: runId, courseId: exam.courseId, metadata: { assignmentId, count: eligible.length } })
  return { ok: true, synced: eligible.length }
}
