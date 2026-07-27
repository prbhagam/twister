'use client'

import { useActionState } from 'react'
import { Button, Notice } from '@/components/ui'
import {
  commitGrading,
  previewGrading,
  type GradingCommitState,
  type GradingPreviewState,
} from './actions'

function MismatchList({
  title,
  tone,
  people,
}: {
  title: string
  tone: 'amber' | 'blue'
  people: { studentId: string; name: string }[]
}) {
  if (people.length === 0) return null
  return (
    <Notice tone={tone} title={`${title} (${people.length})`}>
      <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
        {people.slice(0, 40).map((p) => (
          <li key={p.studentId}>
            {p.name} — {p.studentId}
          </li>
        ))}
        {people.length > 40 ? <li>…and {people.length - 40} more.</li> : null}
      </ul>
    </Notice>
  )
}

export function GradingPanel({ runId }: { runId: string }) {
  const [preview, previewAction, previewPending] = useActionState<GradingPreviewState, FormData>(
    previewGrading,
    {},
  )
  const [commit, commitAction, commitPending] = useActionState<GradingCommitState, FormData>(
    commitGrading,
    {},
  )

  return (
    <div className="space-y-3 px-5 py-4">
      <form action={previewAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="runId" value={runId} />
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-50"
        />
        <Button type="submit" variant="secondary" disabled={previewPending}>
          {previewPending ? 'Checking…' : 'Check CSV'}
        </Button>
      </form>

      <p className="text-xs text-slate-500">
        Upload the Gradescope bubble-sheet export. Only the letters each student marked are used —
        Gradescope&apos;s own &ldquo;correct response&rdquo; columns are ignored, since every paper differs.
      </p>

      {preview.error ? (
        <Notice tone="red" title="Cannot import">
          {preview.error}
        </Notice>
      ) : null}

      {preview.ok ? (
        <div className="space-y-2">
          <Notice tone="green" title={`${preview.matched} students matched`}>
            <p className="mt-1 text-xs">
              {preview.positions} question columns · {preview.missingStatus} row(s) marked Missing by
              Gradescope will be recorded as not taken.
            </p>
          </Notice>

          <MismatchList
            title="In the CSV but not in this run"
            tone="amber"
            people={preview.csvOnly ?? []}
          />
          <MismatchList
            title="In this run but not in the CSV"
            tone="blue"
            people={preview.rosterOnly ?? []}
          />

          <form action={commitAction}>
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="filename" value={preview.filename} />
            <input type="hidden" name="csvText" value={preview.csvText} />
            <Button type="submit" disabled={commitPending}>
              {commitPending ? 'Grading…' : `Grade ${preview.matched} students`}
            </Button>
          </form>
        </div>
      ) : null}

      {commit.error ? <Notice tone="red">{commit.error}</Notice> : null}
      {commit.ok ? (
        <Notice tone="green">Graded {commit.graded} students. Reload to see the results below.</Notice>
      ) : null}
    </div>
  )
}
