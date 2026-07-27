import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { FLAGGED, VERDICT_LABEL, type Verdict } from '@/lib/grading'
import { byLastName } from '@/lib/roster'
import { LETTERS, type LayoutEntry } from '@/lib/seed'
import { Badge, Card, CardHeader, Markdown, Notice } from '@/components/ui'
import { OverrideControl } from './OverrideControl'

export const dynamic = 'force-dynamic'

const VERDICT_TONE: Record<Verdict, 'green' | 'red' | 'amber'> = {
  correct: 'green',
  incorrect: 'red',
  blank: 'amber',
  multi: 'amber',
  out_of_range: 'amber',
}

export default async function StudentReviewPage({
  params,
}: {
  params: Promise<{ runId: string; studentExamId: string }>
}) {
  const { runId, studentExamId } = await params

  const studentExam = await prisma.studentExam.findUnique({
    where: { id: studentExamId },
    include: {
      student: true,
      overrides: true,
      run: {
        include: {
          questions: { include: { variations: { include: { choices: true } } } },
        },
      },
    },
  })
  if (!studentExam || studentExam.runId !== runId) notFound()

  const activeImport = await prisma.gradingImport.findFirst({
    where: { runId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })
  const result = activeImport
    ? await prisma.studentResult.findUnique({
        where: { importId_studentExamId: { importId: activeImport.id, studentExamId } },
        include: { questions: true },
      })
    : null

  // Flatten the run snapshot for lookup — this is the exact content that printed.
  const questionOrder = new Map<string, number>()
  const variationLabel = new Map<string, string>()
  const variationPrompt = new Map<string, string>()
  const choiceHtml = new Map<string, string>()
  for (const question of studentExam.run.questions) {
    questionOrder.set(question.id, question.order)
    for (const variation of question.variations) {
      variationLabel.set(variation.id, variation.label)
      variationPrompt.set(variation.id, variation.promptHtml)
      for (const choice of variation.choices) choiceHtml.set(choice.id, choice.textHtml)
    }
  }

  const layout = (JSON.parse(studentExam.layout) as LayoutEntry[]).sort(
    (a, b) => a.position - b.position,
  )
  const resultByPosition = new Map((result?.questions ?? []).map((q) => [q.position, q]))
  const overrideByPosition = new Map(studentExam.overrides.map((o) => [o.position, o]))

  // Previous/next by last name, so you can walk the flagged pile in roster order.
  const siblings = await prisma.studentExam.findMany({
    where: { runId },
    include: { student: true },
  })
  const ordered = siblings.sort((a, b) => byLastName(a.student, b.student))
  const index = ordered.findIndex((s) => s.id === studentExamId)
  const previous = ordered[index - 1]
  const next = ordered[index + 1]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/runs/${runId}`} className="text-xs text-slate-500 hover:underline">
            ← Back to run
          </Link>
          <h1 className="mt-1 text-lg font-semibold">
            {studentExam.student.firstName} {studentExam.student.lastName}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            GT ID {studentExam.student.gtId} · exam code{' '}
            <code className="font-mono">{studentExam.traceCode}</code>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {previous ? (
            <Link
              href={`/runs/${runId}/students/${previous.id}`}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              ← {previous.student.lastName}
            </Link>
          ) : null}
          {next ? (
            <Link
              href={`/runs/${runId}/students/${next.id}`}
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              {next.student.lastName} →
            </Link>
          ) : null}
        </div>
      </div>

      {result ? (
        <Notice tone={result.status === 'not_taken' ? 'amber' : 'blue'}>
          <span className="font-semibold">
            {result.status === 'not_taken'
              ? 'No scanned sheet — Gradescope reported this student as Missing.'
              : `Score ${result.earned} / ${result.possible} (${result.possible > 0 ? ((result.earned / result.possible) * 100).toFixed(1) : '0.0'}%)`}
          </span>
        </Notice>
      ) : (
        <Notice tone="amber">This run has not been graded yet. The correct answers are shown below.</Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]">
          <CardHeader
            title="The exam this student actually received"
            action={
              <a
                href={`/api/runs/${runId}/pdf/${studentExamId}`}
                className="text-xs text-slate-600 underline hover:text-slate-900"
              >
                Open PDF
              </a>
            }
          />
          {studentExam.pdfPath ? (
            <iframe
              src={`/api/runs/${runId}/pdf/${studentExamId}`}
              title="Student exam PDF"
              className="h-[calc(100%-3.5rem)] w-full border-0"
            />
          ) : (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              PDF not rendered yet for this student.
            </p>
          )}
        </Card>

        <div className="space-y-3">
          {layout.map((entry) => {
            const questionResult = resultByPosition.get(entry.position)
            const verdict = (questionResult?.verdict ?? null) as Verdict | null
            const marked = questionResult ? (JSON.parse(questionResult.letters) as string[]) : []
            const override = overrideByPosition.get(entry.position)

            return (
              <Card key={entry.position} id={`q${entry.position}`}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      Question {entry.position}
                      <span className="text-xs font-normal text-slate-400">
                        from #{questionOrder.get(entry.runQuestionId)}
                        {variationLabel.get(entry.runVariationId)}
                      </span>
                      {verdict ? <Badge tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Badge> : null}
                      {override ? <Badge tone="blue">overridden</Badge> : null}
                    </span>
                  }
                  action={
                    questionResult ? (
                      <span className="text-xs tabular-nums text-slate-500">
                        {questionResult.awarded}/{questionResult.possible}
                      </span>
                    ) : null
                  }
                />

                <div className="space-y-3 px-5 py-4">
                  <Markdown html={variationPrompt.get(entry.runVariationId) ?? ''} className="text-sm" />

                  <ul className="space-y-1">
                    {entry.choiceOrder.map((choiceId, i) => {
                      const letter = LETTERS[i]
                      const isCorrect = letter === entry.correctLetter
                      const isMarked = marked.includes(letter)
                      return (
                        <li
                          key={choiceId}
                          className={`flex gap-2 rounded px-2 py-1 text-sm ${
                            isCorrect
                              ? 'bg-emerald-50'
                              : isMarked
                                ? 'bg-red-50'
                                : ''
                          }`}
                        >
                          <span className="w-4 font-semibold text-slate-500">{letter}</span>
                          <Markdown html={choiceHtml.get(choiceId) ?? ''} className="flex-1" />
                          <span className="flex shrink-0 gap-1 text-[11px]">
                            {isCorrect ? <Badge tone="green">key</Badge> : null}
                            {isMarked ? <Badge tone={isCorrect ? 'green' : 'red'}>marked</Badge> : null}
                          </span>
                        </li>
                      )
                    })}
                  </ul>

                  {questionResult ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <span>
                        Scanned as{' '}
                        <code className="font-mono">{questionResult.rawResponse || '(blank)'}</code> ·
                        key <code className="font-mono">{entry.correctLetter}</code>
                      </span>
                      {verdict && (FLAGGED.includes(verdict) || override) ? (
                        <OverrideControl
                          runId={runId}
                          studentExamId={studentExamId}
                          position={entry.position}
                          possible={questionResult.possible}
                          current={override?.awarded ?? null}
                          note={override?.note ?? ''}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
