'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { parseRoster } from '@/lib/roster'

export interface RosterImportState {
  ok?: boolean
  imported?: number
  excluded?: { role: string; count: number }[]
  sections?: { code: string; label: string; count: number }[]
  errors?: string[]
}

/**
 * Imports a GT roster CSV. Students are upserted on (courseId, gtId) so a
 * re-uploaded roster updates names and sections instead of duplicating people —
 * and, critically, keeps each student's id stable so existing generated exams
 * still point at them.
 */
export async function importRoster(
  _prev: RosterImportState,
  formData: FormData,
): Promise<RosterImportState> {
  const courseId = String(formData.get('courseId'))
  const file = formData.get('file')

  if (!(file instanceof File) || file.size === 0) {
    return { errors: ['Choose a roster CSV to upload.'] }
  }

  const result = parseRoster(await file.text())
  if (result.students.length === 0) {
    return { errors: result.errors.length ? result.errors : ['No student rows found in that CSV.'] }
  }

  const record = await prisma.rosterImport.create({
    data: {
      courseId,
      filename: file.name,
      imported: result.students.length,
      skipped: result.excluded.reduce((sum, e) => sum + e.count, 0),
      skipDetail: JSON.stringify(result.excluded),
    },
  })

  for (const student of result.students) {
    // The GT roster CSV always carries a GT ID, so it stays the upsert key here;
    // the username rides along so an exam seeded on usernames also works.
    if (!student.gtId) continue
    await prisma.student.upsert({
      where: { courseId_gtId: { courseId, gtId: student.gtId } },
      create: {
        courseId,
        importId: record.id,
        gtId: student.gtId,
        username: student.username,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        sections: JSON.stringify(student.sections),
        role: student.role,
      },
      update: {
        importId: record.id,
        username: student.username,
        firstName: student.firstName,
        lastName: student.lastName,
        email: student.email,
        sections: JSON.stringify(student.sections),
      },
    })
  }

  revalidatePath(`/courses/${courseId}`)
  return {
    ok: true,
    imported: result.students.length,
    excluded: result.excluded,
    sections: result.sections,
    errors: result.errors,
  }
}
