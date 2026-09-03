import { prisma } from './db'
import {
  deriveDefaultLabel,
  matchSignupRows,
  matchSlotForSession,
  type ClassifiedSlot,
  type SignupSheetFetchResult,
} from './google-sheets'

export interface SignupSyncDetail {
  unmatched: { gtId: string; canvasUserId: string; name: string; signupSlot: string }[]
  warnings: string[]
}

export interface SignupSyncResult {
  rowCount: number
  matchedCount: number
  detail: SignupSyncDetail
}

/**
 * Makes the stored signup state match a freshly fetched sheet. Every non-dropped
 * roster student ends up pointing at exactly one SignupBucket — a session, an
 * exception, or "not signed up" — whether or not the sheet actually mentioned
 * them, so downstream consumers (the dashboard, the by-session ZIP) never have
 * to special-case "no signup row at all" as long as at least one sync has run.
 *
 * Buckets are upserted rather than replaced: an instructor-edited label or
 * capacity survives a bucket that this sync finds zero students in, the same
 * "flag, don't delete" approach Student.droppedAt uses.
 */
export async function syncSignupsForExam(examId: string, fetched: SignupSheetFetchResult): Promise<SignupSyncResult> {
  return prisma.$transaction(async (tx) => {
    const exam = await tx.exam.findUniqueOrThrow({ where: { id: examId }, select: { courseId: true } })
    const roster = await tx.student.findMany({ where: { courseId: exam.courseId, droppedAt: null } })

    const matchReport = matchSignupRows(fetched.rows, roster)

    // Every exam needs a not_signed_up bucket, whether or not any row today
    // literally says so — students absent from the sheet default into it too.
    const notSignedUpBucket = await tx.signupBucket.upsert({
      where: { examId_kind_naturalKey: { examId, kind: 'not_signed_up', naturalKey: 'not_signed_up' } },
      create: { examId, kind: 'not_signed_up', naturalKey: 'not_signed_up', rawLabel: 'Not signed up' },
      update: {},
    })

    // One bucket per distinct (kind, naturalKey) among this sync's matched rows.
    const distinctSlots = new Map<string, ClassifiedSlot>()
    for (const { row } of matchReport.matched) {
      if (row.classified.kind === 'not_signed_up') continue // already have the bucket
      distinctSlots.set(`${row.classified.kind}:${row.classified.naturalKey}`, row.classified)
    }

    const bucketIdByKey = new Map<string, string>([['not_signed_up:not_signed_up', notSignedUpBucket.id]])
    for (const [key, classified] of distinctSlots) {
      const slotMatch = classified.kind === 'session' ? matchSlotForSession(classified.naturalKey, fetched.slots) : null
      const bucket = await tx.signupBucket.upsert({
        where: { examId_kind_naturalKey: { examId, kind: classified.kind, naturalKey: classified.naturalKey } },
        create: {
          examId,
          kind: classified.kind,
          naturalKey: classified.naturalKey,
          rawLabel: classified.rawLabel,
          sessionAt: classified.sessionAt,
          location: classified.location,
          label: classified.kind === 'exception' ? deriveDefaultLabel(classified.rawLabel) : null,
          capacity: slotMatch?.capacity ?? null,
        },
        update: {
          // Cosmetic refresh; label is instructor-owned and never touched here.
          rawLabel: classified.rawLabel,
          sessionAt: classified.sessionAt,
          location: classified.location,
          // Only overwritten when this sync actually found a Slots-tab match, so
          // a manual override or a prior sync's value survives a gap in that tab.
          ...(slotMatch ? { capacity: slotMatch.capacity } : {}),
        },
      })
      bucketIdByKey.set(key, bucket.id)
    }

    for (const { studentId, row, matchedOn } of matchReport.matched) {
      const bucketId = bucketIdByKey.get(`${row.classified.kind}:${row.classified.naturalKey}`)!
      await tx.signupRow.upsert({
        where: { examId_studentId: { examId, studentId } },
        create: { examId, studentId, bucketId, rawSignupSlot: row.rawSignupSlot, matchedOn },
        update: { bucketId, rawSignupSlot: row.rawSignupSlot, matchedOn },
      })
    }

    // A roster student with no matched row (never on the sheet at all) defaults
    // into not_signed_up too, same as one whose row literally says so.
    const matchedStudentIds = new Set(matchReport.matched.map((m) => m.studentId))
    for (const student of roster) {
      if (matchedStudentIds.has(student.id)) continue
      await tx.signupRow.upsert({
        where: { examId_studentId: { examId, studentId: student.id } },
        create: { examId, studentId: student.id, bucketId: notSignedUpBucket.id, rawSignupSlot: '', matchedOn: null },
        update: { bucketId: notSignedUpBucket.id, rawSignupSlot: '', matchedOn: null },
      })
    }

    const detail: SignupSyncDetail = { unmatched: matchReport.unmatched, warnings: fetched.warnings }
    await tx.signupImport.updateMany({ where: { examId }, data: { isActive: false } })
    await tx.signupImport.create({
      data: {
        examId,
        rowCount: fetched.rows.length,
        matchedCount: matchReport.matched.length,
        detail: JSON.stringify(detail),
        isActive: true,
      },
    })

    return { rowCount: fetched.rows.length, matchedCount: matchReport.matched.length, detail }
  })
}

/** Records a sync attempt that never got as far as reading any rows (bad URL,
 * sheet not link-shared, no header row) — still visible on the dashboard as
 * "last sync failed: …" rather than the previous sync's data going stale with no
 * explanation. */
export async function recordFailedSignupImport(examId: string, error: string): Promise<void> {
  await prisma.$transaction([
    prisma.signupImport.updateMany({ where: { examId }, data: { isActive: false } }),
    prisma.signupImport.create({ data: { examId, error, isActive: true } }),
  ])
}
