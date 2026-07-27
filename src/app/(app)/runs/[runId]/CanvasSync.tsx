'use client'

import { useActionState, useState } from 'react'
import { Button, Notice } from '@/components/ui'
import { MISSING_MARK } from '@/lib/export'
import { syncCanvasGrades, type CanvasSyncState } from './actions'

export function CanvasSync({
  runId,
  ready,
  missingCount = 0,
}: {
  runId: string
  ready: boolean
  /** Students in this run with no scanned sheet. */
  missingCount?: number
}) {
  const [state, action, pending] = useActionState<CanvasSyncState, FormData>(syncCanvasGrades, {})
  const [submittedOnly, setSubmittedOnly] = useState(true)

  return (
    <div className="space-y-3 px-5 py-4">
      <p className="text-xs text-slate-500">
        Posts Canvas-mapped results to one Canvas assignment. This changes Canvas grades.
      </p>

      <form action={action} className="space-y-2">
        <input type="hidden" name="runId" value={runId} />
        <input
          name="assignmentId"
          inputMode="numeric"
          required
          placeholder="Canvas assignment ID"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />

        {missingCount > 0 ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
            <input
              type="checkbox"
              name="submittedOnly"
              checked={submittedOnly}
              onChange={(e) => setSubmittedOnly(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Only students with submissions
              <span className="mt-0.5 block text-slate-500">
                {submittedOnly
                  ? `Skips ${missingCount} student${missingCount === 1 ? '' : 's'} with no scanned sheet, leaving their Canvas grade untouched.`
                  : `Also posts ${MISSING_MARK} for the ${missingCount} student${missingCount === 1 ? '' : 's'} with no scanned sheet.`}
              </span>
            </span>
          </label>
        ) : null}

        {!submittedOnly && missingCount > 0 ? (
          <Notice tone="amber">
            Canvas accepts a number, a percentage, a letter grade, or <code>EX</code> as a grade,
            so it will most likely reject <code>{MISSING_MARK}</code>. Those students are listed
            afterwards rather than stopping the run.
          </Notice>
        ) : null}

        <input
          name="confirmation"
          required
          placeholder="Type PUSH to confirm"
          className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <Button type="submit" disabled={pending || !ready} className="w-full">
          {pending ? 'Syncing…' : 'Push grades to Canvas'}
        </Button>
      </form>

      {!ready ? <Notice tone="amber">Import a Gradescope result before syncing.</Notice> : null}
      {state.error ? <Notice tone="red">{state.error}</Notice> : null}

      {state.ok ? (
        <Notice tone={state.failed?.length ? 'amber' : 'green'}>
          Posted {state.synced} grade{state.synced === 1 ? '' : 's'} to Canvas.
          {state.unmapped
            ? ` ${state.unmapped} graded student(s) have no Canvas user mapped and were skipped.`
            : ''}
        </Notice>
      ) : null}

      {state.failed?.length ? (
        <Notice tone="red" title={`Canvas rejected ${state.failed.length} grade(s)`}>
          <ul className="mt-1 max-h-40 overflow-y-auto text-xs">
            {state.failed.map((f) => (
              <li key={f.name}>
                {f.name} — sent <code>{f.grade}</code>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  )
}
