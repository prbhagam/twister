import { createReadStream } from 'node:fs'
import path from 'node:path'
import { ZipArchive, type Archiver } from 'archiver'
import { prisma } from './db'
import { runDir } from './generation'
import {
  COVER_SHEET_FILE,
  INSTRUCTIONS_FILE,
  buildCoverSheetPdf,
  buildInstructionsPdf,
  type PacketStudent,
  type SessionPacket,
} from './pdf/session-packet'
import { byLastName } from './roster'

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
 * Whether a folder gets a cover sheet and proctor instructions in front of its
 * papers.
 *
 * Both sheets describe papers a TA physically carries to a room and signs for,
 * which is true of a session and of an exception group (those papers are handed
 * over too, just on an arrangement made off the sheet — so the cover sheet
 * prints blank date/time/location rules for those). It is not true of the
 * not-signed-up pile or the never-synced safety-net folder: nobody is
 * proctoring those, and a custody sheet claiming otherwise would be a lie on
 * paper.
 */
export function wantsPacketSheets(kind: string): boolean {
  return kind === 'session' || kind === 'exception'
}

/**
 * Streams a ZIP of one run's already-rendered student PDFs, grouped into
 * folders by that student's current signup bucket for the run's exam. Student
 * PDFs are read off disk only — no rendering, unlike graded-export.ts's
 * course-wide export — because generation already produced every one of them;
 * the two packet sheets per session folder are the only thing built here.
 */
export async function streamRunBySessionZip(runId: string): Promise<{ archive: Archiver; entryCount: number }> {
  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: { studentExams: { include: { student: true } } },
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

  /**
   * Grouped first, appended second: the cover sheet states how many papers are
   * in the folder and the instructions carry its roster, so neither can be
   * written until every student has been placed.
   */
  interface Folder {
    bucket: (typeof buckets)[number] | null
    files: { pdfPath: string; student: (typeof run.studentExams)[number]['student'] }[]
  }
  const folders = new Map<string, Folder>()

  for (const se of run.studentExams) {
    if (!se.pdfPath) continue // not generated for this student yet

    // Missing entirely from bucketByStudentId means this exam has never been
    // synced — a safety-net folder, not the normal path. After any sync, every
    // student has a SignupRow, even one pointing at "not_signed_up".
    const bucket = bucketByStudentId.get(se.studentId) ?? null
    const name = bucket ? bucketFolderName(bucket) : 'No signup data (sheet not synced)'

    let folder = folders.get(name)
    if (!folder) {
      folder = { bucket, files: [] }
      folders.set(name, folder)
    }
    folder.files.push({ pdfPath: se.pdfPath, student: se.student })
  }

  let entryCount = 0
  for (const [name, folder] of folders) {
    if (folder.bucket && wantsPacketSheets(folder.bucket.kind)) {
      const packet = buildPacket(run, folder.bucket, folder.files.map((f) => f.student))
      archive.append(Buffer.from(await buildCoverSheetPdf(packet)), { name: `${name}/${COVER_SHEET_FILE}` })
      archive.append(Buffer.from(await buildInstructionsPdf(packet)), { name: `${name}/${INSTRUCTIONS_FILE}` })
    }

    for (const file of folder.files) {
      archive.append(createReadStream(path.join(dir, file.pdfPath)), { name: `${name}/${file.pdfPath}` })
      // Deliberately counts student papers only: the route reads this as "was
      // anything generated for this run", which the packet sheets never answer.
      entryCount++
    }
  }

  archive.finalize()
  return { archive, entryCount }
}

interface PacketRun {
  examTitle: string
  courseName: string
}

interface PacketBucket {
  kind: string
  rawLabel: string
  label: string | null
  sessionAt: Date | null
  location: string | null
}

/**
 * Assembles what the two sheets print. The exam and course names come off the
 * run's own snapshot, not the live exam, for the same reason the booklet's
 * cover page does: a rename must not rewrite what a printed packet said.
 */
export function buildPacket(
  run: PacketRun,
  bucket: PacketBucket,
  students: { firstName: string; lastName: string; gtId: string | null; username: string | null }[],
): SessionPacket {
  const roster: PacketStudent[] = students
    .map((s) => ({ firstName: s.firstName, lastName: s.lastName, identity: s.gtId ?? s.username ?? null }))
    .sort(byLastName)

  return {
    courseName: run.courseName,
    examTitle: run.examTitle,
    sessionLabel: bucket.kind === 'exception' ? bucket.label || bucket.rawLabel : bucket.rawLabel,
    sessionAt: bucket.sessionAt,
    location: bucket.location,
    students: roster,
  }
}
