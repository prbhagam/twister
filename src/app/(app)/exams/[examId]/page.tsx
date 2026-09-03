import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { validateExam } from '@/lib/exam-validation'
import { IDENTITY_HINT, IDENTITY_LABEL, IDENTITY_FIELDS, parseIdentityField, studentsMissingIdentity } from '@/lib/identity'
import { toPlainSummary } from '@/lib/markdown'
import { practiceVariantLabels } from '@/lib/practice-exam'
import { excludedStudentCount, parseSectionCodes, summarizeSections } from '@/lib/sections'
import { distinctExamCount, formatBig } from '@/lib/seed'
import { Badge, Button, Card, CardHeader, Empty, Input, Label, LinkButton, Notice, Textarea } from '@/components/ui'
import { DangerZone } from '@/components/DangerZone'
import { deleteExam, updateExam } from '../../actions'
import { addQuestion, approveAllQuestions, moveQuestion, transitionQuestionStatus } from './actions'
import { CsvImport } from './CsvImport'
import { GeneratePanel } from './GeneratePanel'
import { PracticeGeneratePanel } from './PracticeGeneratePanel'
import { requireExamPermission } from '@/lib/authorization'

export const dynamic = 'force-dynamic'

export default async function ExamPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params
  await requireExamPermission(examId, 'course:view')

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      // Dropped students are off the roster and are never generated for, so they
      // must not inflate the section counts the generate panel promises.
      course: { include: { students: { where: { droppedAt: null } } } },
      questions: {
        where: { archivedAt: null },
        orderBy: { order: 'asc' },
        include: {
          variations: { orderBy: { order: 'asc' }, include: { choices: { orderBy: { order: 'asc' } } } },
        },
      },
      runs: { orderBy: { createdAt: 'desc' }, include: { _count: { select: { studentExams: true } } } },
    },
  })
  if (!exam) notFound()

  const issues = validateExam(exam)
  const errors = issues.filter((i) => i.level === 'error')
  const warnings = issues.filter((i) => i.level === 'warning')

  const identityField = parseIdentityField(exam.identityField)
  const identityLocked = exam.runs.length > 0
  const missingIdentity = studentsMissingIdentity(exam.course.students, identityField)

  // Sections excluded on the course are not offered here at all: they are a course
  // policy, and showing them as pickable would imply generating for them is a
  // per-run decision.
  const excludedSections = parseSectionCodes(exam.course.excludedSections)
  const sections = summarizeSections(exam.course.students, excludedSections).filter((s) => !s.excluded)
  const excludedStudents = excludedStudentCount(exam.course.students, excludedSections)
  const generatableStudents = exam.course.students.length - excludedStudents

  // Only meaningful once the equal-variation-count check above has passed; when
  // counts differ these are just the first question's variations and `errors`
  // already blocks the buttons.
  const variantLabels = practiceVariantLabels(exam.questions[0]?.variations ?? [])

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/courses/${exam.courseId}`} className="text-xs text-slate-500 hover:underline">
          ← {exam.course.name}
        </Link>
        <h1 className="mt-1 text-lg font-semibold">{exam.title}</h1>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_21rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Questions"
              subtitle={`${exam.questions.length} question${exam.questions.length === 1 ? '' : 's'} · ${exam.questions.reduce((n, q) => n + q.variations.length, 0)} variations`}
              action={<div className="flex gap-2">
                <a
                  href={`/api/exams/${exam.id}/question-bank.pdf`}
                  title="Every question and variation with the correct answers marked. Instructor copy — do not hand out."
                  className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Question bank (PDF)
                </a>
                <form action={approveAllQuestions}>
                  <input type="hidden" name="examId" value={exam.id} />
                  <Button type="submit" variant="secondary" disabled={errors.length > 0 || exam.questions.length === 0}>
                    Approve all valid
                  </Button>
                </form>
                <form action={addQuestion}>
                  <input type="hidden" name="examId" value={exam.id} />
                  <Button type="submit" variant="secondary">
                    Add question
                  </Button>
                </form>
              </div>}
            />

            {exam.questions.length === 0 ? (
              <Empty>No questions yet. Add one, or import a whole-exam CSV below.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {exam.questions.map((question, index) => {
                  const questionIssues = issues.filter((i) => i.questionId === question.id)
                  const blocking = questionIssues.some((i) => i.level === 'error')
                  return (
                    <li key={question.id} className="flex items-start gap-3 px-5 py-3">
                      <span className="w-5 pt-0.5 text-sm font-semibold text-slate-400">{question.order}</span>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/exams/${exam.id}/questions/${question.id}`}
                          className="block text-sm hover:underline"
                        >
                          {toPlainSummary(question.variations[0]?.promptMarkdown ?? '') || (
                            <span className="text-slate-400">Empty question</span>
                          )}
                        </Link>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge>
                            {question.variations.length} variation
                            {question.variations.length === 1 ? '' : 's'}
                          </Badge>
                          <Badge>
                            {question.points} pt{question.points === 1 ? '' : 's'}
                          </Badge>
                          <Badge tone={question.workflowStatus === 'APPROVED' ? 'green' : 'amber'}>
                            {question.workflowStatus.toLowerCase().replace(/_/g, ' ')}
                          </Badge>
                          {question.allowMultipleCorrect ? <Badge tone="blue">select all</Badge> : null}
                          {question.variations.map((v) => (
                            <Badge key={v.id} tone={v.choices.length < 5 ? 'amber' : 'neutral'}>
                              {v.label}: {v.choices.length} choices
                            </Badge>
                          ))}
                          {blocking ? <Badge tone="red">needs attention</Badge> : null}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <form action={transitionQuestionStatus} className="flex gap-1">
                          <input type="hidden" name="examId" value={exam.id} />
                          <input type="hidden" name="questionId" value={question.id} />
                          <select
                            name="status"
                            defaultValue={question.workflowStatus}
                            className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-600"
                            aria-label={`Question ${question.order} workflow status`}
                          >
                            <option value="DRAFT">Draft</option>
                            <option value="IN_REVIEW">In review</option>
                            <option value="APPROVED">Approved</option>
                            <option value="RETIRED">Retired</option>
                          </select>
                          <button type="submit" className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
                            Update
                          </button>
                        </form>
                        <form action={moveQuestion}>
                          <input type="hidden" name="questionId" value={question.id} />
                          <input type="hidden" name="direction" value="up" />
                          <button
                            type="submit"
                            disabled={index === 0}
                            className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                          >
                            ↑
                          </button>
                        </form>
                        <form action={moveQuestion}>
                          <input type="hidden" name="questionId" value={question.id} />
                          <input type="hidden" name="direction" value="down" />
                          <button
                            type="submit"
                            disabled={index === exam.questions.length - 1}
                            className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                          >
                            ↓
                          </button>
                        </form>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="border-t border-slate-100 px-5 py-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-slate-600">Import / export the whole question bank</p>
                <a
                  href={`/api/exams/${exam.id}/questions.csv`}
                  className="text-xs text-slate-600 underline hover:text-slate-900"
                >
                  Download current as CSV
                </a>
              </div>
              <CsvImport
                examId={exam.id}
                hint="Whole-exam CSV (question_number, points, allow_multiple, variation_label, prompt, choice_1…choice_5, correct, pin_last). correct may list more than one index only when allow_multiple is set on the question's first row. This replaces every question in the exam."
              />
            </div>
          </Card>

          {exam.isPracticeExam ? (
            <Card>
              <CardHeader
                title="Generate practice exams"
                subtitle="No roster, no grading — one PDF per variant, rendered from the live questions"
              />
              <PracticeGeneratePanel examId={exam.id} variantLabels={variantLabels} blocked={errors.length > 0} />
            </Card>
          ) : (
            <Card>
              <CardHeader
                title="Generate exams"
                subtitle="Freezes a snapshot, then renders one PDF per student"
              />
              <GeneratePanel
                examId={exam.id}
                sections={sections}
                totalStudents={generatableStudents}
                excludedSections={excludedSections.length}
                excludedStudents={excludedStudents}
                courseId={exam.courseId}
                blocked={errors.length > 0}
                distinctExams={formatBig(distinctExamCount(exam.questions))}
              />
            </Card>
          )}

          {!exam.isPracticeExam && exam.runs.length > 0 ? (
            <Card>
              <CardHeader title="Generation runs" />
              <ul className="divide-y divide-slate-100">
                {exam.runs.map((run) => (
                  <li key={run.id}>
                    <Link
                      href={`/runs/${run.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-slate-50"
                    >
                      <span>
                        {run.label ?? run.createdAt.toLocaleString()}
                        <span className="ml-2 text-xs text-slate-500">
                          {run._count.studentExams} students
                        </span>
                      </span>
                      <Badge
                        tone={
                          run.status === 'completed'
                            ? 'green'
                            : run.status === 'failed'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {run.status === 'running'
                          ? `${run.completedCount}/${run.studentCount}`
                          : run.status}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          {errors.length > 0 || warnings.length > 0 ? (
            <Card>
              <CardHeader
                title="Validation"
                subtitle={`${errors.length} blocking · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
              />
              <div className="space-y-2 px-5 py-4">
                {errors.length > 0 ? (
                  <Notice tone="red" title="Blocks generation">
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {errors.map((issue, i) => (
                        <li key={i}>{issue.message}</li>
                      ))}
                    </ul>
                  </Notice>
                ) : null}
                {warnings.length > 0 ? (
                  <Notice tone="amber" title="Worth checking">
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {warnings.map((issue, i) => (
                        <li key={i}>{issue.message}</li>
                      ))}
                    </ul>
                  </Notice>
                ) : null}
              </div>
            </Card>
          ) : (
            <Notice tone="green" title="Ready to generate">
              No blocking issues.
            </Notice>
          )}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Exam settings</h2>
            <form action={updateExam} className="space-y-3">
              <input type="hidden" name="examId" value={exam.id} />
              <div>
                <Label htmlFor="title">Title</Label>
                <Input id="title" name="title" defaultValue={exam.title} required />
              </div>
              <div>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="isPracticeExam"
                    defaultChecked={exam.isPracticeExam}
                    disabled={exam.runs.length > 0}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 disabled:opacity-50"
                  />
                  <span>
                    This is a practice exam
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Skips the roster: generating renders one PDF per variant instead of one per
                      student. Requires every question to have the same number of variations.
                      {exam.runs.length > 0
                        ? ' Locked because this exam already has generation runs.'
                        : ''}
                    </span>
                  </span>
                </label>
              </div>
              <div>
                <Label htmlFor="instructorSeed">Instructor seed</Label>
                <Input id="instructorSeed" name="instructorSeed" defaultValue={exam.instructorSeed} required />
                <p className="mt-1 text-xs text-slate-500">
                  Combined with each student&apos;s GT ID to pick their paper. Keep it secret, and do not
                  change it after printing — the same students would get different exams.
                </p>
              </div>
              <div>
                <Label htmlFor="identityField">Student identifier</Label>
                <select
                  id="identityField"
                  name="identityField"
                  defaultValue={identityField}
                  disabled={identityLocked}
                  className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                >
                  {IDENTITY_FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {IDENTITY_LABEL[field]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  {IDENTITY_HINT[identityField]}{' '}
                  {identityLocked
                    ? 'Locked because exams have already been generated — changing it would reseed every student onto a different paper.'
                    : 'This must match what Gradescope matches its roster on, or no scanned sheet will auto-match.'}
                </p>
                {missingIdentity.length > 0 ? (
                  <p className="mt-1 text-xs font-medium text-red-700">
                    {missingIdentity.length} student(s) have no {IDENTITY_LABEL[identityField]} and cannot be
                    generated.
                  </p>
                ) : null}
              </div>
              <div>
                <Label htmlFor="instructions">Cover page instructions (markdown)</Label>
                <Textarea
                  id="instructions"
                  name="instructions"
                  rows={5}
                  defaultValue={exam.instructions ?? ''}
                  placeholder="You have 50 minutes. Mark all answers on the bubble sheet."
                />
              </div>
              <Button type="submit" className="w-full">
                Save settings
              </Button>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-red-800">Delete exam</h2>
            <p className="mb-3 text-xs text-slate-500">
              The course roster is not affected.
            </p>
            <DangerZone
              action={deleteExam}
              hiddenFields={{ examId: exam.id }}
              label="Delete this exam"
              description={`This permanently deletes "${exam.title}": ${exam.questions.length} question(s), ${exam.runs.length} generation run(s) with their grades, and all generated PDFs. This cannot be undone.`}
              confirmHint="To confirm, type the exam title:"
              confirmWord={exam.title}
              buttonText="Delete exam permanently"
            />
          </Card>
        </div>
      </div>
    </div>
  )
}
