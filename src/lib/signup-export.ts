import { createReadStream } from 'node:fs'
import path from 'node:path'
import { ZipArchive, type Archiver } from 'archiver'
import { prisma } from './db'
import { runDir } from './generation'

/**
 * Sanitizes a bucket's own label into a filesystem-safe folder name, preserving
 * readability (spaces, punctuation) rather than slugging it the way
 * generation.ts's pdfFileName / graded-export.ts's folderName do for single
 * files — these are container folders meant for a human browsing the ZIP, and
 * the date/time/location already read naturally as-is once the filesystem-
 * illegal characters (path separators, colons) are swapped out.
 */
function sanitizeFolderName(raw: string): string {
  return raw.replace(/[\\/:*?"<>|\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim()
}

interface FolderBucket {
  kind: string
  rawLabel: string
  label: string | null
}

/** "10/27/2026 1:35 PM (Scheller 101)" for a session — the date, time, and
 * location the folder needs to carry are already right there in rawLabel. */
export function bucketFolderName(bucket: FolderBucket): string {
  if (bucket.kind === 'not_signed_up') return 'Not signed up'
  if (bucket.kind === 'exception') return sanitizeFolderName(bucket.label || bucket.rawLabel)
  return sanitizeFolderName(bucket.rawLabel)
}

/**
 * Streams a ZIP of one run's already-rendered student PDFs, grouped into
 * folders by that student's current signup bucket for the run's exam. Reads
 * files off disk only — no rendering, unlike graded-export.ts's course-wide
 * export — because generation already produced every PDF this needs.
 */
export async function streamRunBySessionZip(runId: string): Promise<{ archive: Archiver; entryCount: number }> {
  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: { studentExams: true },
  })
  const buckets = await prisma.signupBucket.findMany({
    where: { examId: run.examId },
    include: { rows: true },
  })
  const bucketByStudentId = new Map<string, (typeof buckets)[number]>()
  for (const bucket of buckets) for (const row of bucket.rows) bucketByStudentId.set(row.studentId, bucket)

  // PDFs are already compressed; deflating again costs time and saves nothing.
  const archive = new ZipArchive({ zlib: { level: 0 }, store: true })
  const dir = runDir(runId)
  let entryCount = 0

  for (const se of run.studentExams) {
    if (!se.pdfPath) continue // not generated for this student yet

    // Missing entirely from bucketByStudentId means this exam has never been
    // synced — a safety-net folder, not the normal path. After any sync, every
    // student has a SignupRow, even one pointing at "not_signed_up".
    const bucket = bucketByStudentId.get(se.studentId)
    const folder = bucket ? bucketFolderName(bucket) : 'No signup data (sheet not synced)'

    archive.append(createReadStream(path.join(dir, se.pdfPath)), { name: `${folder}/${se.pdfPath}` })
    entryCount++
  }

  archive.finalize()
  return { archive, entryCount }
}
