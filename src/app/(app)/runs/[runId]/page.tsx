import Link from 'next/link'
import { notFound } from 'next/navigation'
import { canvasPreflight } from '@/lib/export'
import { prisma } from '@/lib/db'
import { FLAGGED } from '@/lib/grading'
import { sectionLabel } from '@/lib/roster'
import { loadScoreRows } from '@/lib/run-data'
import { byLastName } from '@/lib/roster'
import { Badge, Button, Card, CardHeader, Empty, Notice } from '@/components/ui'
import { DangerZone } from '@/components/DangerZone'
import { deleteRun } from '../../actions'
import { retryRun } from './actions'
import { GradingPanel } from './GradingPanel'
import { RunProgress } from './RunProgress'
import { CanvasSync } from './CanvasSync'

export const dynamic = 'force-dynamic'

function DownloadLink({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <a
      href={href}
      className="block rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-slate-400 hover:bg-slate-50"
    >
      <span className="font-medium text-slate-900">{title}</span>
      <span className="mt-0.5 block text-xs text-slate-500">{note}</span>
    </a>
  )
}

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params

  const run = await prisma.generationRun.findUnique({
    where: { id: runId },
    include: {
      exam: { include: { course: true } },
      _count: { select: { questions: true, studentExams: true } },
    },
  })
  if (!run) notFound()

  const { rows, filename } = await loadScoreRows(runId)
  const graded = rows.filter((r) => r.status === 'graded')
  const flaggedCount = graded.reduce(
    (n, row) => n + row.questions.filter((q) => FLAGGED.includes(q.verdict) && !q.overridden).length,
    0,
  )
  const sortedRows = rows.slice().sort((a, b) => byLastName(a.student, b.student))

  const studentExams = await prisma.studentExam.findMany({
    where: { runId },
    include: { student: true },
  })
  // Keyed on whichever identifier the student has; gtId may be absent.
  const examIdByStudent = new Map(
    studentExams.map((se) => [se.student.gtId ?? se.student.username ?? se.student.email, se.id]),
  )

  const average =
    graded.length > 0
      ? graded.reduce((sum, r) => sum + (r.possible > 0 ? r.earned / r.possible : 0), 0) / graded.length
      : 0

  const sections = (JSON.parse(run.sections) as string[]).map(sectionLabel)
  const canvasIssues = canvasPreflight(rows)
  const canvasSyncReady = Boolean(filename) && rows.some((row) => row.status === 'graded')

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/exams/${run.examId}`} className="text-xs text-slate-500 hover:underline">
          ← {run.exam.title}
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold">
          {run.label ?? `Run of ${run.createdAt.toLocaleString()}`}
          <Badge tone={run.status === 'completed' ? 'green' : run.status === 'failed' ? 'red' : 'amber'}>
            {run.status}
          </Badge>
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">
          {run._count.studentExams} students · {run._count.questions} questions ·{' '}
          {sections.length ? `sections ${sections.join(', ')}` : 'all sections'} · seed{' '}
          <code className="font-mono">{run.seedUsed}</code>
        </p>
      </div>

      {run.status !== 'completed' ? (
        <Card>
          <RunProgress
            runId={run.id}
            initialStatus={run.status}
            initialCompleted={run.completedCount}
            total={run.studentCount}
          />
          {run.status === 'failed' ? (
            <div className="space-y-3 border-t border-slate-100 px-5 py-4">
              <Notice tone="red" title="Generation failed">
                <pre className="mt-1 whitespace-pre-wrap font-sans text-xs">{run.error}</pre>
              </Notice>
              <form action={retryRun}>
                <input type="hidden" name="runId" value={run.id} />
                <Button type="submit" variant="secondary">
                  Retry generation
                </Button>
              </form>
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Grading"
              subtitle={
                filename
                  ? `Last imported ${filename} · ${graded.length} graded`
                  : 'Upload the Gradescope export to grade this run'
              }
            />
            <GradingPanel runId={run.id} />
          </Card>

          <Card>
            <CardHeader
              title="Students"
              subtitle={
                graded.length > 0
                  ? `Average ${(average * 100).toFixed(1)}% · ${flaggedCount} unresolved flag${flaggedCount === 1 ? '' : 's'}`
                  : 'Not graded yet'
              }
            />
            {sortedRows.length === 0 ? (
              <Empty>No students in this run.</Empty>
            ) : (
              <div className="max-h-[32rem] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-2 text-left font-medium">Student</th>
                      <th className="px-3 py-2 text-left font-medium">GT ID</th>
                      <th className="px-3 py-2 text-left font-medium">Code</th>
                      <th className="px-3 py-2 text-right font-medium">Score</th>
                      <th className="px-5 py-2 text-right font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sortedRows.map((row) => {
                      const studentKey = row.student.gtId ?? row.student.username ?? row.student.email
                      const studentExamId = examIdByStudent.get(studentKey)
                      const flags = row.questions.filter(
                        (q) => FLAGGED.includes(q.verdict) && !q.overridden,
                      ).length
                      return (
                        <tr key={studentKey} className="hover:bg-slate-50">
                          <td className="px-5 py-1.5">
                            {studentExamId ? (
                              <Link
                                href={`/runs/${run.id}/students/${studentExamId}`}
                                className="hover:underline"
                              >
                                {row.student.lastName}, {row.student.firstName}
                              </Link>
                            ) : (
                              `${row.student.lastName}, ${row.student.firstName}`
                            )}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs text-slate-500">
                            {row.student.gtId ?? row.student.username ?? '—'}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs text-slate-400">
                            {row.student.traceCode}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {row.status === 'not_taken' ? (
                              <span className="text-xs text-slate-400">not taken</span>
                            ) : (
                              <>
                                {row.earned}
                                <span className="text-slate-400">/{row.possible}</span>
                              </>
                            )}
                          </td>
                          <td className="px-5 py-1.5 text-right">
                            {flags > 0 ? <Badge tone="amber">{flags}</Badge> : null}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Downloads" />
            <div className="space-y-2 px-5 py-4">
              {run.status === 'completed' ? (
                <DownloadLink
                  href={`/api/runs/${run.id}/print.pdf`}
                  title="Print all exams (PDF)"
                  note={`${run.studentCount} booklets, ordered by last name`}
                />
              ) : null}
              <DownloadLink
                href={`/api/runs/${run.id}/answer-key.csv`}
                title="Answer key (CSV)"
                note="Correct letter per student per bubble position"
              />
              {graded.length > 0 ? (
                <>
                  <DownloadLink
                    href={`/api/runs/${run.id}/scores.csv`}
                    title="Scores (CSV)"
                    note="Alphabetical by last name"
                  />
                  <DownloadLink
                    href={`/api/runs/${run.id}/canvas.csv`}
                    title="Canvas gradebook (CSV)"
                    note="Import via the Canvas gradebook"
                  />
                </>
              ) : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Canvas grade sync" />
            <CanvasSync runId={run.id} ready={canvasSyncReady} />
          </Card>

          {graded.length > 0 && canvasIssues.length > 0 ? (
            <Notice tone="amber" title="Before importing to Canvas">
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                {canvasIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold text-red-800">Delete run</h2>
            <p className="mb-3 text-xs text-slate-500">
              The exam and its questions are not affected.
            </p>
            <DangerZone
              action={deleteRun}
              hiddenFields={{ runId: run.id }}
              label="Delete this run"
              description={`This permanently deletes this run: ${run._count.studentExams} student exam(s), their answer keys, any imported grades, and the generated PDFs. Papers already printed from it will no longer be gradable.`}
              confirmHint="To confirm, type:"
              confirmWord="delete"
              buttonText="Delete run permanently"
            />
          </Card>

          <Card className="px-5 py-4 text-xs text-slate-600">
            <p className="font-medium text-slate-900">This run is frozen.</p>
            <p className="mt-1">
              Every question, variation, and choice was copied when the run started. Editing the exam
              now has no effect on these papers or on how they grade.
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
