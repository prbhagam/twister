'use server'

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { parseIdentityField } from '@/lib/identity'

export async function createCourse(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return

  const course = await prisma.course.create({
    data: {
      name,
      title: String(formData.get('title') ?? '').trim() || null,
      term: String(formData.get('term') ?? '').trim() || null,
    },
  })
  redirect(`/courses/${course.id}`)
}

/**
 * Removes the generated PDFs for a set of runs.
 *
 * Database rows cascade, but the PDFs are files on disk and would otherwise be
 * orphaned — a full class is ~90 MB per run.
 */
async function removeRunOutput(runIds: string[]) {
  const { rm } = await import('node:fs/promises')
  const { runDir } = await import('@/lib/generation')

  await Promise.all(
    runIds.map((id) =>
      rm(runDir(id), { recursive: true, force: true }).catch((error) => {
        // A missing or unreadable directory must not block the delete; the rows are
        // already gone and leaving files behind is recoverable, a half-delete is not.
        console.error(`[twister] could not remove output for run ${id}:`, error)
      }),
    ),
  )
}

/**
 * Deletes a course and everything under it: exams, questions, roster, generation
 * runs, grades, and the PDFs on disk. Irreversible, so the UI requires the course
 * name to be typed before this is reachable.
 */
export async function deleteCourse(formData: FormData) {
  const courseId = String(formData.get('courseId'))
  const confirmation = String(formData.get('confirm') ?? '').trim()

  const course = await prisma.course.findUniqueOrThrow({
    where: { id: courseId },
    include: { exams: { include: { runs: { select: { id: true } } } } },
  })
  if (confirmation !== course.name) return

  const runIds = course.exams.flatMap((exam) => exam.runs.map((run) => run.id))
  await prisma.course.delete({ where: { id: courseId } })
  await removeRunOutput(runIds)

  revalidatePath('/')
  redirect('/')
}

export async function createExam(formData: FormData) {
  const courseId = String(formData.get('courseId'))
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return

  const exam = await prisma.exam.create({
    data: {
      courseId,
      title,
      // A random default keeps anyone from generating with a guessable seed by
      // accident; it stays editable.
      instructorSeed: randomBytes(9).toString('base64url'),
    },
  })
  redirect(`/exams/${exam.id}`)
}

/**
 * Deletes an exam and everything under it: questions, generation runs, grades, and
 * the PDFs on disk. The roster is untouched — it belongs to the course.
 */
export async function deleteExam(formData: FormData) {
  const examId = String(formData.get('examId'))
  const confirmation = String(formData.get('confirm') ?? '').trim()

  const exam = await prisma.exam.findUniqueOrThrow({
    where: { id: examId },
    include: { runs: { select: { id: true } } },
  })
  if (confirmation !== exam.title) return

  const runIds = exam.runs.map((run) => run.id)
  await prisma.exam.delete({ where: { id: examId } })
  await removeRunOutput(runIds)

  revalidatePath(`/courses/${exam.courseId}`)
  redirect(`/courses/${exam.courseId}`)
}

/** Deletes a single generation run: its layouts, grades, and PDFs. */
export async function deleteRun(formData: FormData) {
  const runId = String(formData.get('runId'))
  const confirmation = String(formData.get('confirm') ?? '').trim()
  if (confirmation !== 'delete') return

  const run = await prisma.generationRun.delete({ where: { id: runId } })
  await removeRunOutput([runId])

  revalidatePath(`/exams/${run.examId}`)
  redirect(`/exams/${run.examId}`)
}

export async function updateExam(formData: FormData) {
  const examId = String(formData.get('examId'))
  const identityField = parseIdentityField(String(formData.get('identityField') ?? ''))

  const exam = await prisma.exam.findUniqueOrThrow({
    where: { id: examId },
    include: { _count: { select: { runs: true } } },
  })

  // Changing the identity reseeds every student onto a different paper and changes
  // what is stamped in the bubble sheet's ID box. Once exams exist it is almost
  // always a mistake, so it is locked; existing runs keep their own snapshot either
  // way, but a new run would no longer match the printed sheets.
  const lockIdentity = exam._count.runs > 0

  await prisma.exam.update({
    where: { id: examId },
    data: {
      title: String(formData.get('title') ?? '').trim(),
      instructorSeed: String(formData.get('instructorSeed') ?? '').trim(),
      instructions: String(formData.get('instructions') ?? '').trim() || null,
      ...(lockIdentity ? {} : { identityField }),
    },
  })
  revalidatePath(`/exams/${examId}`)
}
