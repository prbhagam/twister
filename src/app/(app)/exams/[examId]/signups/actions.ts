'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { audit } from '@/lib/audit'
import { requireExamPermission } from '@/lib/authorization'
import { fetchAndParseSignupSheet } from '@/lib/google-sheets'
import { recordFailedSignupImport, syncSignupsForExam, type SignupSyncDetail } from '@/lib/signup-sync'

export interface SignupSyncState {
  ok?: boolean
  rowCount?: number
  matchedCount?: number
  warnings?: string[]
  unmatched?: SignupSyncDetail['unmatched']
  error?: string
}

/**
 * Fetches Exam.signupSheetUrl and replaces the current signup picture with what
 * it says now. The URL is saved before the fetch, not after, so a transient
 * outage never erases what was pasted — only a fetch/parse failure is reported
 * back without touching anything already synced.
 */
export async function syncSignupSheet(_prev: SignupSyncState, formData: FormData): Promise<SignupSyncState> {
  const examId = String(formData.get('examId'))
  const sheetUrl = String(formData.get('signupSheetUrl') ?? '').trim()
  const user = await requireExamPermission(examId, 'course:manage')

  if (!sheetUrl) return { error: 'Paste a Google Sheet link first.' }

  const exam = await prisma.exam.update({ where: { id: examId }, data: { signupSheetUrl: sheetUrl } })

  const fetched = await fetchAndParseSignupSheet(sheetUrl)
  if (fetched.errors.length) {
    const message = fetched.errors.join(' ')
    await recordFailedSignupImport(examId, message)
    revalidatePath(`/exams/${examId}/signups`)
    return { error: message }
  }

  const result = await syncSignupsForExam(examId, fetched)

  await audit({
    actorUserId: user.id,
    action: 'exam.signups_synced',
    entityType: 'exam',
    entityId: examId,
    courseId: exam.courseId,
    metadata: { rowCount: result.rowCount, matchedCount: result.matchedCount, unmatchedCount: result.detail.unmatched.length },
  })
  revalidatePath(`/exams/${examId}/signups`)
  revalidatePath(`/exams/${examId}`)

  return {
    ok: true,
    rowCount: result.rowCount,
    matchedCount: result.matchedCount,
    warnings: result.detail.warnings,
    unmatched: result.detail.unmatched,
  }
}

/** Sets or clears the capacity override on one session bucket. Blank clears it
 * back to whatever the Slots tab last provided (or unset, if it never matched). */
export async function updateBucketCapacity(formData: FormData): Promise<void> {
  const examId = String(formData.get('examId'))
  const bucketId = String(formData.get('bucketId'))
  const raw = String(formData.get('capacity') ?? '').trim()
  const user = await requireExamPermission(examId, 'course:manage')

  const bucket = await prisma.signupBucket.findUniqueOrThrow({ where: { id: bucketId } })
  if (bucket.examId !== examId) return

  const capacity = raw === '' ? null : Number.isFinite(Number(raw)) ? Number(raw) : bucket.capacity
  await prisma.signupBucket.update({ where: { id: bucketId }, data: { capacity } })

  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } })
  await audit({ actorUserId: user.id, action: 'signup_bucket.capacity_updated', entityType: 'signup_bucket', entityId: bucketId, courseId: exam.courseId, metadata: { capacity } })
  revalidatePath(`/exams/${examId}/signups`)
}

/** Sets or clears the short editable label on one exception bucket. Blank falls
 * back to the auto-derived default / raw sentence in the UI. */
export async function updateBucketLabel(formData: FormData): Promise<void> {
  const examId = String(formData.get('examId'))
  const bucketId = String(formData.get('bucketId'))
  const label = String(formData.get('label') ?? '').trim() || null
  const user = await requireExamPermission(examId, 'course:manage')

  const bucket = await prisma.signupBucket.findUniqueOrThrow({ where: { id: bucketId } })
  if (bucket.examId !== examId) return

  await prisma.signupBucket.update({ where: { id: bucketId }, data: { label } })

  const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } })
  await audit({ actorUserId: user.id, action: 'signup_bucket.label_updated', entityType: 'signup_bucket', entityId: bucketId, courseId: exam.courseId, metadata: { label } })
  revalidatePath(`/exams/${examId}/signups`)
}
