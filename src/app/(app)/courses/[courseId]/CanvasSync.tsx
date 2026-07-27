'use client'

import { useActionState } from 'react'
import { Badge, Button, Notice } from '@/components/ui'
import { commitCanvasSync, previewCanvasSync, type CanvasSyncState } from './canvas-actions'

export function CanvasSync({
  courseId,
  courses,
  linkedCanvasCourseId,
  loadError,
}: {
  courseId: string
  courses: { id: string; name: string; term?: string }[]
  linkedCanvasCourseId: string | null
  loadError: string | null
}) {
  const [preview, previewAction, previewPending] = useActionState<CanvasSyncState, FormData>(
    previewCanvasSync,
    {},
  )
  const [commit, commitAction, commitPending] = useActionState<CanvasSyncState, FormData>(
    commitCanvasSync,
    {},
  )

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
        <input type="hidden" name="courseId" value={courseId} />
        <select
          name="canvasCourseId"
          defaultValue={linkedCanvasCourseId ?? ''}
          required
          className="min-w-64 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
        >
          <option value="" disabled>
            Choose a Canvas course…
          </option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.name}
              {course.term ? ` · ${course.term}` : ''}
            </option>
          ))}
        </select>
        <Button type="submit" variant="secondary" disabled={previewPending}>
          {previewPending ? 'Checking…' : 'Check for changes'}
        </Button>
      </form>

      <p className="text-xs text-slate-500">
        Pulls the live roster, so students who added or dropped since your last import are picked up.
        Nothing is written until you confirm.
      </p>

      {preview.error ? (
        <Notice tone="red" title="Sync failed">
          {preview.error}
        </Notice>
      ) : null}

      {preview.rejected && preview.rejected.length > 0 ? (
        <Notice tone="amber" title={`${preview.rejected.length} student(s) cannot be imported`}>
          <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
            {preview.rejected.slice(0, 20).map((r) => (
              <li key={r.name}>
                {r.name} — {r.reason}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {preview.ok ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Badge tone={preview.added?.length ? 'green' : 'neutral'}>
              {preview.added?.length ?? 0} added
            </Badge>
            <Badge tone={preview.removed?.length ? 'amber' : 'neutral'}>
              {preview.removed?.length ?? 0} no longer enrolled
            </Badge>
            <Badge tone={preview.changed?.length ? 'blue' : 'neutral'}>
              {preview.changed?.length ?? 0} changed
            </Badge>
            <Badge>{preview.unchanged ?? 0} unchanged</Badge>
          </div>

          {preview.added && preview.added.length > 0 ? (
            <Notice tone="green" title="Will be added">
              <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
                {preview.added.map((s) => (
                  <li key={s.gtId}>
                    {s.name} — {s.gtId} {s.sections.join(', ')}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {preview.removed && preview.removed.length > 0 ? (
            <Notice tone="amber" title="No longer enrolled in Canvas">
              <p className="mt-1 text-xs">
                These stay in TWISTER rather than being deleted — they may already have a generated
                exam and grades. Exclude them by section when you generate.
              </p>
              <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
                {preview.removed.map((s) => (
                  <li key={s.gtId}>
                    {s.name} — {s.gtId}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          {preview.changed && preview.changed.length > 0 ? (
            <Notice tone="blue" title="Will be updated">
              <ul className="mt-1 max-h-32 overflow-y-auto text-xs">
                {preview.changed.slice(0, 30).map((c, i) => (
                  <li key={`${c.gtId}-${i}`}>
                    {c.gtId} {c.field}: {c.from || '(none)'} → {c.to || '(none)'}
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}

          <form action={commitAction}>
            <input type="hidden" name="courseId" value={courseId} />
            <input type="hidden" name="canvasCourseId" value={preview.canvasCourseId} />
            <Button type="submit" disabled={commitPending}>
              {commitPending ? 'Syncing…' : 'Apply sync'}
            </Button>
          </form>
        </div>
      ) : null}

      {commit.error ? <Notice tone="red">{commit.error}</Notice> : null}
      {commit.applied ? (
        <Notice tone="green" title="Roster synced">
          {commit.applied.added} added, {commit.applied.updated} updated. Reload to see the list.
        </Notice>
      ) : null}
    </div>
  )
}
