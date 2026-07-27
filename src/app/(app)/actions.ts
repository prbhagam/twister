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

export async function deleteCourse(formData: FormData) {
  await prisma.course.delete({ where: { id: String(formData.get('courseId')) } })
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

export async function deleteExam(formData: FormData) {
  const exam = await prisma.exam.delete({ where: { id: String(formData.get('examId')) } })
  redirect(`/courses/${exam.courseId}`)
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
