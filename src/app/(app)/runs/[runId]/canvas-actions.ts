'use server'

import { revalidatePath } from 'next/cache'
import {
  CanvasClient,
  gradePushWarnings,
  gradesToPush,
  planGradePush,
  type GradeChange,
} from '@/lib/canvas'
import { prisma } from '@/lib/db'
import { loadScoreRows } from '@/lib/run-data'

export interface CanvasPushState {
  ok?: boolean
  error?: string
  assignmentId?: string
  assignmentName?: string
  changes?: GradeChange[]
  conflicts?: GradeChange[]
  unchangedCount?: number
  skippedNotTaken?: { gtId: string; name: string }[]
  skippedNoGtId?: { gtId: string; name: string }[]
  warnings?: string[]
  totalToPush?: number
  pushed?: number
  progressState?: string
}

/**
 * Maps every identifier a student might be keyed on to their Canvas user id.
 *
 * Both `sis_user_id` and `login_id` are indexed. Keying on SIS id alone leaves the
 * map empty for a roster synced from a token without SIS access, so no existing
 * Canvas score is ever found, every push looks like a new grade, and the conflict
 * warning that stops you overwriting hand-entered grades never fires.
 */
function canvasIdIndex(students: { id: number; sis_user_id?: string | null; login_id?: string | null }[]) {
  const index = new Map<string, number>()
  for (const user of students) {
    for (const key of [user.sis_user_id, user.login_id]) {
      const trimmed = key?.trim()
      if (trimmed && !index.has(trimmed)) index.set(trimmed, user.id)
    }
  }
  return index
}

async function resolveTarget(runId: string, assignmentId: string) {
  const client = CanvasClient.fromEnv()
  if (!client) throw new Error('Canvas is not configured. Set CANVAS_BASE_URL and CANVAS_TOKEN.')

  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: { exam: { include: { course: true } } },
  })
  const canvasCourseId = run.exam.course.canvasCourseId
  if (!canvasCourseId) {
    throw new Error('This course is not linked to a Canvas course yet. Link it on the course page.')
  }

  return { client, run, canvasCourseId, assignmentId }
}

/**
 * Dry run. Nothing is written to Canvas here — this exists so a push to real
 * student records is never the first time you see what it will do.
 */
export async function previewCanvasPush(
  _prev: CanvasPushState,
  formData: FormData,
): Promise<CanvasPushState> {
  const runId = String(formData.get('runId'))
  const assignmentId = String(formData.get('assignmentId') ?? '').trim()
  if (!assignmentId) return { error: 'Choose a Canvas assignment first.' }

  try {
    const { client, canvasCourseId } = await resolveTarget(runId, assignmentId)

    const [students, submissions, assignments, { rows }] = await Promise.all([
      client.listStudents(canvasCourseId),
      client.listSubmissions(canvasCourseId, assignmentId),
      client.listAssignments(canvasCourseId),
      loadScoreRows(runId),
    ])

    const assignment = assignments.find((a) => String(a.id) === assignmentId) ?? null
    const idByGtId = canvasIdIndex(students)

    const plan = planGradePush(rows, submissions, idByGtId)

    return {
      ok: true,
      assignmentId,
      assignmentName: assignment?.name,
      changes: plan.changes,
      conflicts: plan.conflicts,
      unchangedCount: plan.unchanged.length,
      skippedNotTaken: plan.skippedNotTaken,
      skippedNoGtId: plan.skippedNoGtId,
      warnings: gradePushWarnings(plan, assignment),
      totalToPush: plan.totalToPush,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Sends the grades, then polls Canvas's Progress object until it settles. */
export async function commitCanvasPush(
  _prev: CanvasPushState,
  formData: FormData,
): Promise<CanvasPushState> {
  const runId = String(formData.get('runId'))
  const assignmentId = String(formData.get('assignmentId') ?? '').trim()
  if (!assignmentId) return { error: 'Nothing to push — run the preview again.' }

  try {
    const { client, canvasCourseId, run } = await resolveTarget(runId, assignmentId)

    // Recomputed rather than trusting a round-trip through the browser, so what is
    // pushed always reflects current scores and overrides.
    const [students, submissions, { rows }] = await Promise.all([
      client.listStudents(canvasCourseId),
      client.listSubmissions(canvasCourseId, assignmentId),
      loadScoreRows(runId),
    ])

    const idByGtId = canvasIdIndex(students)
    const plan = planGradePush(rows, submissions, idByGtId)
    const grades = gradesToPush(plan)

    if (grades.length === 0) {
      return { ok: true, pushed: 0, progressState: 'completed', assignmentId }
    }

    const started = await client.updateGrades(canvasCourseId, assignmentId, grades)
    const finished = await client.waitForProgress(started.id)

    if (finished.workflow_state === 'failed') {
      return {
        error: `Canvas reported the grade upload failed${finished.message ? `: ${finished.message}` : '.'} Check the Canvas gradebook before retrying.`,
      }
    }

    await prisma.exam.update({
      where: { id: run.examId },
      data: { canvasAssignmentId: assignmentId },
    })

    revalidatePath(`/runs/${runId}`)
    return { ok: true, pushed: grades.length, progressState: finished.workflow_state, assignmentId }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
