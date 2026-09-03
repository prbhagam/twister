import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ZipArchive, type Archiver } from 'archiver'
import { prisma } from './db'
import { VERDICT_LABEL, type Verdict } from './grading'
import { identityValue, parseIdentityField } from './identity'
import { byLastName } from './roster'
import { LETTERS, type LayoutEntry } from './seed'
import type { GradedReport, ReportQuestion } from './pdf/graded-report'
import { ReportRenderer, stageReportAssets } from './pdf/report-renderer'

/**
 * The runs a course export covers: the most recently graded run of each exam.
 *
 * An exam that was regenerated has several runs, and only one of them is the
 * version that counts. Superseded runs are left out rather than producing near
 * identical PDFs with no indication of which is authoritative.
 */
export async function gradedRunsForCourse(courseId: string) {
  const runs = await prisma.generationRun.findMany({
    where: { exam: { courseId }, imports: { some: { isActive: true } } },
    include: { exam: true },
    orderBy: { createdAt: 'desc' },
  })

  const latestPerExam = new Map<string, (typeof runs)[number]>()
  for (const run of runs) {
    if (!latestPerExam.has(run.examId)) latestPerExam.set(run.examId, run)
  }
  return [...latestPerExam.values()]
}

/** Filesystem-safe, sorts by surname, and stays unique via the identifier. */
function folderName(student: { lastName: string; firstName: string }, identifier: string): string {
  const slug = `${student.lastName}-${student.firstName}`
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug}-${identifier}`
}

function fileName(examTitle: string): string {
  const slug = examTitle
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'exam'}-graded.pdf`
}

/** Builds every report for one run, ready to render. */
async function reportsForRun(runId: string): Promise<{ report: GradedReport; folder: string; file: string }[]> {
  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      exam: { include: { course: true } },
      questions: { include: { variations: { include: { choices: true } } } },
      studentExams: { include: { student: true, overrides: true } },
    },
  })

  // Flatten the frozen snapshot once; every student reads from these.
  const questionOrder = new Map<string, number>()
  const questionPoints = new Map<string, number>()
  const variationLabel = new Map<string, string>()
  const promptHtml = new Map<string, string>()
  const choiceHtml = new Map<string, string>()
  for (const q of run.questions) {
    questionOrder.set(q.id, q.order)
    questionPoints.set(q.id, q.points)
    for (const v of q.variations) {
      variationLabel.set(v.id, v.label)
      promptHtml.set(v.id, v.promptHtml)
      for (const c of v.choices) choiceHtml.set(c.id, c.textHtml)
    }
  }

  const activeImport = await prisma.gradingImport.findFirst({
    where: { runId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })
  const results = activeImport
    ? await prisma.studentResult.findMany({
        where: { importId: activeImport.id },
        include: { questions: true },
      })
    : []
  const resultByStudentExam = new Map(results.map((r) => [r.studentExamId, r]))

  const identityField = parseIdentityField(run.identityField)
  const courseName = [run.exam.course.name, run.exam.course.title].filter(Boolean).join(' — ')

  return run.studentExams
    .slice()
    .sort((a, b) => byLastName(a.student, b.student))
    .map((se) => {
      const identifier = identityValue(se.student, identityField) ?? se.student.email
      const base = {
        courseName,
        examTitle: run.examTitle || run.exam.title,
        studentName: `${se.student.firstName} ${se.student.lastName}`,
        identifier,
        traceCode: se.traceCode,
      }

      const result = resultByStudentExam.get(se.id)
      if (!result || result.status !== 'graded') {
        return {
          folder: folderName(se.student, identifier),
          file: fileName(base.examTitle),
          report: { ...base, questions: [], noSubmission: true } satisfies GradedReport,
        }
      }

      const layout = (JSON.parse(se.layout) as LayoutEntry[]).sort((a, b) => a.position - b.position)
      const byPosition = new Map(result.questions.map((q) => [q.position, q]))
      const overrideByPosition = new Map(se.overrides.map((o) => [o.position, o]))

      const questions: ReportQuestion[] = layout.map((entry) => {
        const qr = byPosition.get(entry.position)
        const marked = qr ? (JSON.parse(qr.letters) as string[]) : []
        const override = overrideByPosition.get(entry.position)
        const verdict = (qr?.verdict ?? 'blank') as Verdict

        return {
          position: entry.position,
          source: `Q${questionOrder.get(entry.runQuestionId) ?? '?'}${variationLabel.get(entry.runVariationId) ?? ''}`,
          promptHtml: promptHtml.get(entry.runVariationId) ?? '',
          choices: entry.choiceOrder.map((choiceId, i) => ({
            letter: LETTERS[i],
            html: choiceHtml.get(choiceId) ?? '',
            chosen: marked.includes(LETTERS[i]),
            correct: entry.correctLetters.includes(LETTERS[i]),
          })),
          verdict,
          verdictLabel: VERDICT_LABEL[verdict] ?? verdict,
          awarded: qr?.awarded ?? 0,
          possible: qr?.possible ?? entry.points ?? questionPoints.get(entry.runQuestionId) ?? 1,
          rawResponse: qr?.rawResponse ?? '',
          overridden: Boolean(override),
          overrideNote: override?.note ?? undefined,
        }
      })

      return {
        folder: folderName(se.student, identifier),
        file: fileName(base.examTitle),
        report: {
          ...base,
          score: { earned: result.earned, possible: result.possible },
          questions,
        } satisfies GradedReport,
      }
    })
}

export interface GradedExportProgress {
  total: number
  done: number
}

/**
 * Streams a ZIP of every graded exam in a course, one folder per student.
 *
 * PDFs are rendered as the archive is written rather than up front: a 400-student
 * course is several hundred megabytes, and buffering it would risk the process
 * before it risked the download.
 */
export async function streamCourseGradedExports(
  courseId: string,
  onProgress?: (progress: GradedExportProgress) => void,
): Promise<{ archive: Archiver; done: Promise<void>; total: number }> {
  const runs = await gradedRunsForCourse(courseId)
  if (runs.length === 0) throw new Error('No graded runs in this course yet.')

  const perRun = await Promise.all(runs.map((run) => reportsForRun(run.id)))
  const entries = perRun.flat()

  // PDFs are already compressed; deflating again costs time and saves nothing.
  const archive = new ZipArchive({ zlib: { level: 0 }, store: true })

  const done = (async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), 'twister-reports-'))
    let renderer: ReportRenderer | null = null
    try {
      const shellPath = await stageReportAssets(workDir)
      renderer = await ReportRenderer.launch({ shellPath })

      let completed = 0
      // Rendered in bounded parallel, appended in order so the archive is
      // deterministic and folders group together.
      const queue = [...entries]
      const inFlight = new Map<number, Promise<{ index: number; pdf: Uint8Array }>>()
      let nextIndex = 0
      let appendIndex = 0
      const pending = new Map<number, Uint8Array>()

      const startNext = () => {
        if (nextIndex >= queue.length) return
        const index = nextIndex++
        const entry = queue[index]
        inFlight.set(
          index,
          renderer!.render(entry.report).then((pdf) => ({ index, pdf })),
        )
      }
      for (let i = 0; i < renderer.concurrency; i++) startNext()

      while (inFlight.size > 0) {
        const { index, pdf } = await Promise.race(inFlight.values())
        inFlight.delete(index)
        pending.set(index, pdf)
        startNext()

        while (pending.has(appendIndex)) {
          const entry = queue[appendIndex]
          archive.append(Buffer.from(pending.get(appendIndex)!), {
            name: `${entry.folder}/${entry.file}`,
          })
          pending.delete(appendIndex)
          appendIndex++
          completed++
          onProgress?.({ total: entries.length, done: completed })
        }
      }

      await archive.finalize()
    } catch (error) {
      archive.abort()
      throw error
    } finally {
      await renderer?.close()
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  })()

  return { archive, done, total: entries.length }
}
