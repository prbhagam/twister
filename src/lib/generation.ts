import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  BLANKS_PER_SESSION,
  blankPdfFileName,
  blankSeedIdentity,
  formatBlankLabel,
} from './blank-exams'
import { prisma } from './db'
import { hasBlockingErrors, validateExam } from './exam-validation'
import { identityValue, parseIdentityField, studentsMissingIdentity } from './identity'
import { renderMarkdown } from './markdown'
import type { RenderExam, RenderQuestion } from './pdf/exam-html'
import { ExamRenderer, buildPrintFile, stageRenderAssets } from './pdf/renderer'
import { byLastName } from './roster'
import { isStudentExcluded, parseSectionCodes } from './sections'
import { buildLayout, pickVersionName, type LayoutEntry, type SeedQuestion } from './seed'
import { parseStoredVersionNames } from './version-names'

export function outputRoot(): string {
  return path.resolve(process.env.TWISTER_OUTPUT_DIR ?? './output')
}

export function runDir(runId: string): string {
  return path.join(outputRoot(), runId)
}

export const PRINT_FILE = 'print-all.pdf'

/** Filenames sort the same way the print stack does: by last name. */
function pdfFileName(student: { lastName: string; firstName: string }, identity: string): string {
  const slug = `${student.lastName}-${student.firstName}`
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug}-${identity}.pdf`
}

/** The parts of a run's frozen question snapshot that layout and rendering read. */
interface SnapshotQuestion {
  id: string
  sourceQuestionId: string
  order: number
  points: number
  variations: {
    id: string
    order: number
    promptHtml: string
    choices: { id: string; order: number; textHtml: string; isCorrect: boolean; pinToLast: boolean }[]
  }[]
}

/**
 * Seeding keys off the *authoring* ids so the same student regenerates
 * identically across runs, while refIds point at this run's frozen copies.
 */
function seedQuestionsFor(questions: SnapshotQuestion[]): SeedQuestion[] {
  return questions
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((q) => ({
      key: q.sourceQuestionId,
      refId: q.id,
      points: q.points,
      variations: q.variations
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((v) => ({
          refId: v.id,
          choices: v.choices
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((c) => ({ refId: c.id, isCorrect: c.isCorrect, pinToLast: c.pinToLast })),
        })),
    }))
}

/** Flattens the snapshot into lookup tables once, so rendering each paper is
 * a handful of map reads rather than a walk of the whole question tree. */
function snapshotLookups(questions: SnapshotQuestion[]) {
  const variationHtml = new Map<string, string>()
  const choiceHtml = new Map<string, string>()
  const questionPoints = new Map<string, number>()
  for (const q of questions) {
    questionPoints.set(q.id, q.points)
    for (const v of q.variations) {
      variationHtml.set(v.id, v.promptHtml)
      for (const c of v.choices) choiceHtml.set(c.id, c.textHtml)
    }
  }

  return (layout: LayoutEntry[]): RenderQuestion[] =>
    layout
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((entry) => ({
        position: entry.position,
        points: entry.points ?? questionPoints.get(entry.runQuestionId) ?? 1,
        promptHtml: variationHtml.get(entry.runVariationId) ?? '',
        choicesHtml: entry.choiceOrder.map((id) => choiceHtml.get(id) ?? ''),
      }))
}

/**
 * Takes the frozen snapshot and computes every student's layout.
 *
 * Everything a printed exam depends on is copied here — prompts, choices, points,
 * course and exam titles — so later edits to the live questions cannot change what
 * grading believes was on the paper.
 */
export async function createRun(params: {
  examId: string
  sections: string[]
  label?: string
}): Promise<{ runId: string; studentCount: number }> {
  const exam = await prisma.exam.findUniqueOrThrow({
    where: { id: params.examId },
    include: {
      course: true,
      // Archived questions are still rows on the exam — a whole-exam CSV import
      // retires the old list rather than deleting it, so grading of an earlier run
      // keeps working. They must never be snapshotted into a *new* run, or the
      // paper carries every retired question alongside the current ones.
      questions: {
        where: { archivedAt: null },
        orderBy: { order: 'asc' },
        include: {
          variations: {
            orderBy: { order: 'asc' },
            include: { choices: { orderBy: { order: 'asc' } } },
          },
        },
      },
    },
  })

  const issues = validateExam(exam)
  if (hasBlockingErrors(issues)) {
    throw new Error(
      `Exam has ${issues.filter((i) => i.level === 'error').length} blocking issue(s):\n` +
        issues
          .filter((i) => i.level === 'error')
          .map((i) => `  • ${i.message}`)
          .join('\n'),
    )
  }

  // Course-level exclusions outrank the per-run section picker: a section marked
  // excluded on the course is withheld even if a stale form posts it back.
  const excludedSections = parseSectionCodes(exam.course.excludedSections)
  const enrolled = await prisma.student.findMany({
    where: { courseId: exam.courseId, droppedAt: null },
    orderBy: { lastName: 'asc' },
  })
  let excludedCount = 0
  const students = enrolled.filter((s) => {
    const sections = parseSectionCodes(s.sections)
    if (isStudentExcluded(sections, excludedSections)) {
      excludedCount++
      return false
    }
    if (params.sections.length === 0) return true
    return sections.some((code) => params.sections.includes(code))
  })

  if (students.length === 0) {
    throw new Error(
      excludedCount > 0
        ? `No students are left to generate: ${excludedCount} of ${enrolled.length} are in sections excluded on the course, and nobody else matches the selected sections.`
        : 'No students match the selected sections. Import a roster first.',
    )
  }

  // Seeding on an empty identifier would give every affected student the *same*
  // paper, so this is caught before anything is generated.
  const identityField = parseIdentityField(exam.identityField)
  const missing = studentsMissingIdentity(students, identityField)
  if (missing.length > 0) {
    const names = missing.slice(0, 5).map((s) => `${s.firstName} ${s.lastName}`).join(', ')
    throw new Error(
      `${missing.length} student(s) have no ${identityField === 'username' ? 'GT username' : 'GT ID'}, ` +
        `which this exam seeds from: ${names}${missing.length > 5 ? `, and ${missing.length - 5} more` : ''}. ` +
        'Re-import the roster with that field, or switch the exam to seed on the other identifier.',
    )
  }

  // Render each variation's markdown once for the whole run rather than per student.
  const renderedPrompts = new Map<string, string>()
  const renderedChoices = new Map<string, string>()
  await Promise.all([
    ...exam.questions.flatMap((q) =>
      q.variations.map(async (v) => {
        renderedPrompts.set(v.id, await renderMarkdown(v.promptMarkdown))
      }),
    ),
    ...exam.questions.flatMap((q) =>
      q.variations.flatMap((v) =>
        v.choices.map(async (c) => {
          renderedChoices.set(c.id, await renderMarkdown(c.textMarkdown))
        }),
      ),
    ),
  ])

  const run = await prisma.generationRun.create({
    data: {
      examId: exam.id,
      label: params.label,
      seedUsed: exam.instructorSeed,
      identityField,
      sections: JSON.stringify(params.sections),
      // Snapshotted so a run records who was deliberately left out, even after the
      // course's exclusion list changes.
      configuration: JSON.stringify({ excludedSections, excludedStudents: excludedCount }),
      status: 'pending',
      studentCount: students.length,
      examTitle: exam.title,
      courseName: [exam.course.name, exam.course.title].filter(Boolean).join(' — '),
      instructions: exam.instructions,
      outputDir: '',
      questions: {
        create: exam.questions.map((q) => ({
          sourceQuestionId: q.id,
          order: q.order,
          title: q.title,
          points: q.points,
          variations: {
            create: q.variations.map((v) => ({
              sourceVariationId: v.id,
              order: v.order,
              label: v.label,
              promptMarkdown: v.promptMarkdown,
              promptHtml: renderedPrompts.get(v.id) ?? '',
              choices: {
                create: v.choices.map((c) => ({
                  sourceChoiceId: c.id,
                  order: c.order,
                  textMarkdown: c.textMarkdown,
                  textHtml: renderedChoices.get(c.id) ?? '',
                  isCorrect: c.isCorrect,
                  pinToLast: c.pinToLast,
                })),
              },
            })),
          },
        })),
      },
    },
    include: {
      questions: { include: { variations: { include: { choices: true } } } },
    },
  })

  await prisma.generationRun.update({
    where: { id: run.id },
    data: { outputDir: runDir(run.id) },
  })

  const seedQuestions = seedQuestionsFor(run.questions)

  const versionNames = parseStoredVersionNames(exam.versionNames)

  await prisma.studentExam.createMany({
    data: students.map((student) => {
      // Seeded from the exam's chosen identity, never blindly from gtId.
      const identity = identityValue(student, identityField)!
      const layout = buildLayout({
        instructorSeed: exam.instructorSeed,
        examId: exam.id,
        gtId: identity,
        questions: seedQuestions,
      })
      return {
        runId: run.id,
        studentId: student.id,
        traceCode: layout.traceCode,
        layout: JSON.stringify(layout.entries),
        // Fixed here with the layout, not at render time, so re-rendering a run
        // reprints the same name even if the exam's list has changed since.
        versionName: pickVersionName({
          instructorSeed: exam.instructorSeed,
          examId: exam.id,
          gtId: identity,
          names: versionNames,
        }),
      }
    }),
  })

  return { runId: run.id, studentCount: students.length }
}

/**
 * Renders every PDF for a run. Long-running: callers kick this off and poll
 * `completedCount` rather than awaiting the response.
 */
export async function executeRun(runId: string): Promise<void> {
  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      questions: { include: { variations: { include: { choices: true } } } },
      studentExams: { include: { student: true } },
    },
  })

  const dir = runDir(runId)
  await mkdir(dir, { recursive: true })
  await prisma.generationRun.update({
    where: { id: runId },
    data: { status: 'running', completedCount: 0, error: null, outputDir: dir },
  })

  const renderQuestions = snapshotLookups(run.questions)

  const runIdentityField = parseIdentityField(run.identityField)
  const instructionsHtml = run.instructions ? await renderMarkdown(run.instructions) : undefined
  // Renderer startup (especially Chromium) is the most common local failure point.
  // It must be captured below so a run never remains permanently "running".
  let renderer: ExamRenderer | undefined
  try {
    const shellPath = await stageRenderAssets(dir)
    renderer = await ExamRenderer.launch({ shellPath })
  } catch (error) {
    await prisma.generationRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      },
    })
    throw error
  }

  const ordered = run.studentExams
    .slice()
    .sort((a, b) => byLastName(a.student, b.student))

  // For a small local test run, show useful progress after every booklet. Large
  // classes retain batched SQLite writes.
  const progressEvery = ordered.length <= 20 ? 1 : 5

  try {
    let completed = 0

    // Bounded concurrency: the renderer owns a fixed page pool, and queueing every
    // student at once would just pile up promises.
    const queue = [...ordered]
    const workers = Array.from({ length: renderer.concurrency }, async () => {
      for (;;) {
        const item = queue.shift()
        if (!item) return

        const layout = JSON.parse(item.layout) as LayoutEntry[]
        const exam: RenderExam = {
          examTitle: run.examTitle,
          courseName: run.courseName,
          studentName: `${item.student.firstName} ${item.student.lastName}`,
          // Printed into the bubble sheet's ID box, so it must be whatever
          // Gradescope matches its roster on.
          gtId: identityValue(item.student, runIdentityField) ?? '',
          traceCode: item.traceCode,
          versionName: item.versionName ?? undefined,
          instructionsHtml,
          katexHref: 'katex.min.css',
          questions: renderQuestions(layout),
        }

        const { pdf, pageCount } = await renderer.render(exam)
        const fileName = pdfFileName(item.student, identityValue(item.student, runIdentityField) ?? item.id)
        await writeFile(path.join(dir, fileName), pdf)

        await prisma.studentExam.update({
          where: { id: item.id },
          data: { pdfPath: fileName, pageCount },
        })

        completed++
        // Batch the progress writes; 404 individual updates would thrash SQLite.
        if (completed % progressEvery === 0 || completed === ordered.length) {
          await prisma.generationRun.update({
            where: { id: runId },
            data: { completedCount: completed },
          })
        }
      }
    })

    await Promise.all(workers)

    // One print job, in the same last-name order as the filenames.
    const merged = await buildPrintFile({
      students: ordered.map((s) => ({
        path: path.join(dir, pdfFileName(s.student, identityValue(s.student, runIdentityField) ?? s.id)),
        name: `${s.student.firstName} ${s.student.lastName}`,
        gtId: identityValue(s.student, runIdentityField) ?? '',
      })),
    })
    await writeFile(path.join(dir, PRINT_FILE), merged)

    await prisma.generationRun.update({
      where: { id: runId },
      data: { status: 'completed', completedCount: ordered.length, finishedAt: new Date() },
    })
  } catch (error) {
    await prisma.generationRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      },
    })
    throw error
  } finally {
    await renderer.close()
  }
}

export interface BlankSession {
  /** SignupBucket.naturalKey — stable across re-syncs of the sheet. */
  key: string
  /** The session as the sign-up sheet wrote it, recorded on each blank for display. */
  name: string
}

/**
 * Makes sure each session has its BLANKS_PER_SESSION blank exams in this run,
 * creating whichever are missing. Creates rows only; renderPendingBlanks draws
 * their PDFs.
 *
 * Idempotent, so the by-session ZIP can call it on every download: a session
 * gets its blanks the first time it is exported and keeps the same ones after,
 * which is what lets a reprinted blank still grade against its recorded key.
 *
 * Numbers are allocated across every run of the exam, not just this one, so no
 * two blanks for the same exam ever print the same label.
 */
export async function ensureSessionBlanks(runId: string, sessions: BlankSession[]): Promise<void> {
  if (sessions.length > 0) {
    const run = await prisma.generationRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        exam: true,
        questions: { include: { variations: { include: { choices: true } } } },
      },
    })
    const seedQuestions = seedQuestionsFor(run.questions)
    // The exam's current list, not a snapshot: the run never recorded one, and
    // the name is decorative. It is fixed on the blank once chosen.
    const versionNames = parseStoredVersionNames(run.exam.versionNames)

    await prisma.$transaction(async (tx) => {
      const existing = await tx.blankExam.findMany({ where: { runId }, select: { sessionKey: true, slot: true } })
      const have = new Set(existing.map((b) => `${b.sessionKey}\u0000${b.slot}`))
      const highest = await tx.blankExam.aggregate({ where: { examId: run.examId }, _max: { number: true } })
      let next = (highest._max.number ?? 0) + 1

      for (const session of sessions) {
        for (let slot = 1; slot <= BLANKS_PER_SESSION; slot++) {
          if (have.has(`${session.key}\u0000${slot}`)) continue
          const number = next++
          // Seeded exactly the way a student's paper is, from the run's own
          // snapshot of the instructor seed, with the blank's number standing in
          // for the student's identity.
          const identity = blankSeedIdentity(number)
          const layout = buildLayout({
            instructorSeed: run.seedUsed,
            examId: run.examId,
            gtId: identity,
            questions: seedQuestions,
          })
          await tx.blankExam.create({
            data: {
              runId,
              examId: run.examId,
              number,
              sessionKey: session.key,
              sessionName: session.name,
              slot,
              traceCode: layout.traceCode,
              layout: JSON.stringify(layout.entries),
              versionName: pickVersionName({
                instructorSeed: run.seedUsed,
                examId: run.examId,
                gtId: identity,
                names: versionNames,
              }),
            },
          })
        }
      }
    })
  }
}

/**
 * Renders every blank in this run that has no PDF yet. Blanks already rendered
 * are left alone, so after a session's first export this launches nothing.
 */
export async function renderPendingBlanks(runId: string): Promise<void> {
  const pending = await prisma.blankExam.findMany({ where: { runId, pdfPath: null } })
  if (pending.length === 0) return

  const run = await prisma.generationRun.findUniqueOrThrow({
    where: { id: runId },
    include: { questions: { include: { variations: { include: { choices: true } } } } },
  })
  const renderQuestions = snapshotLookups(run.questions)
  const instructionsHtml = run.instructions ? await renderMarkdown(run.instructions) : undefined

  const dir = runDir(runId)
  await mkdir(dir, { recursive: true })
  const renderer = await ExamRenderer.launch({ shellPath: await stageRenderAssets(dir) })
  try {
    await Promise.all(
      pending.map(async (blank) => {
        const { pdf, pageCount } = await renderer.render({
          examTitle: run.examTitle,
          courseName: run.courseName,
          // Left empty for the student to write in; nothing is stamped on the
          // bubble sheet either, so Gradescope reads the ID they bubble.
          studentName: '',
          gtId: '',
          blankLabel: formatBlankLabel(blank.number),
          traceCode: blank.traceCode,
          versionName: blank.versionName ?? undefined,
          instructionsHtml,
          katexHref: 'katex.min.css',
          questions: renderQuestions(JSON.parse(blank.layout) as LayoutEntry[]),
        })
        const fileName = blankPdfFileName(blank.number)
        await writeFile(path.join(dir, fileName), pdf)
        await prisma.blankExam.update({ where: { id: blank.id }, data: { pdfPath: fileName, pageCount } })
      }),
    )
  } finally {
    await renderer.close()
  }
}
