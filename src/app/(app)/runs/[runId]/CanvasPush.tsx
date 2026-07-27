'use client'

import { useActionState } from 'react'
import { Badge, Button, Notice } from '@/components/ui'
import { commitCanvasPush, previewCanvasPush, type CanvasPushState } from './canvas-actions'

export function CanvasPush({
  runId,
  assignments,
  linkedAssignmentId,
  loadError,
  courseLinked,
}: {
  runId: string
  assignments: { id: string; name: string; points: number | null; published: boolean }[]
  linkedAssignmentId: string | null
  loadError: string | null
  courseLinked: boolean
}) {
  const [preview, previewAction, previewPending] = useActionState<CanvasPushState, FormData>(
    previewCanvasPush,
    {},
  )
  const [commit, commitAction, commitPending] = useActionState<CanvasPushState, FormData>(
    commitCanvasPush,
    {},
  )

  if (!courseLinked) {
    return (
      <p className="px-5 py-4 text-sm text-slate-500">
        Link this course to a Canvas course first, on the course page.
      </p>
    )
  }

  if (loadError) {
    return (
      <div className="px-5 py-4">
        <Notice tone="red" title="Could not reach Canvas">
          {loadError}
        </Notice>
      </div>
    )
  }

  return (
    <div className="space-y-3 px-5 py-4">
      <form action={previewAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="runId" value={runId} />
        <select
          name="assignmentId"
          defaultValue={linkedAssignmentId ?? ''}
          required
          className="min-w-64 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
        >
          <option value="" disabled>
            Choose a Canvas assignment…
          </option>
          {assignments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.points != null ? ` · ${a.points} pts` : ''}
              {a.published ? '' : ' · unpublished'}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" disabled={previewPending}>
          {previewPending ? 'Checking…' : 'Preview push'}
        </Button>
      </form>

      <p className="text-xs text-slate-500">
        Grades are matched to Canvas by GT ID. Nothing is written until you confirm.
      </p>

      {preview.error ? (
        <Notice tone="red" title="Cannot push">
          {preview.error}
        </Notice>
      ) : null}

      {preview.ok ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge tone={preview.changes?.length ? 'green' : 'neutral'}>
              {preview.changes?.length ?? 0} new
            </Badge>
            <Badge tone={preview.conflicts?.length ? 'amber' : 'neutral'}>
              {preview.conflicts?.length ?? 0} would be overwritten
            </Badge>
            <Badge>{preview.unchangedCount ?? 0} already match</Badge>
            <Badge tone={preview.skippedNotTaken?.length ? 'blue' : 'neutral'}>
              {preview.skippedNotTaken?.length ?? 0} skipped (no sheet)
            </Badge>
          </div>

          {preview.warnings && preview.warnings.length > 0 ? (
            <Notice tone="amber" title="Before you push">
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {preview.conflicts && preview.conflicts.length > 0 ? (
            <Notice tone="amber" title={`${preview.conflicts.length} existing Canvas score(s) differ`}>
              <p className="mt-1 text-xs">
                Usually this means someone graded by hand in Canvas. Pushing replaces those scores.
              </p>
              <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
                {preview.conflicts.slice(0, 30).map((c) => (
                  <li key={c.gtId}>
                    {c.name} — Canvas has {c.existing}, TWISTER has {c.score}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {preview.skippedNoGtId && preview.skippedNoGtId.length > 0 ? (
            <Notice tone="red" title="Cannot be matched in Canvas">
              <ul className="mt-1 max-h-24 overflow-y-auto text-xs">
                {preview.skippedNoGtId.map((s) => (
                  <li key={s.gtId}>
                    {s.name} — {s.gtId || '(no GT ID)'}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <form action={commitAction}>
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="assignmentId" value={preview.assignmentId} />
            <Button type="submit" disabled={commitPending || preview.totalToPush === 0}>
              {commitPending
                ? 'Pushing…'
                : preview.totalToPush === 0
                  ? 'Nothing to push'
                  : `Push ${preview.totalToPush} score${preview.totalToPush === 1 ? '' : 's'} to ${preview.assignmentName ?? 'Canvas'}`}
            </Button>
          </form>
        </div>
      ) : null}

      {commit.error ? <Notice tone="red">{commit.error}</Notice> : null}
      {commit.ok ? (
        <Notice tone="green" title={`Pushed ${commit.pushed} score(s)`}>
          Canvas reported the upload {commit.progressState}.
        </Notice>
      ) : null}
    </div>
  )
}
