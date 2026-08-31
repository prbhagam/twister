'use client'

import { useActionState } from 'react'
import { Button, Notice } from '@/components/ui'
import { importCanvasRoster, type RosterImportState } from './actions'

export function RosterUpload({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState<RosterImportState, FormData>(importCanvasRoster, {})

  return (
    <div className="space-y-3 px-5 py-4">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="courseId" value={courseId} />
        <input name="canvasCourseId" inputMode="numeric" required placeholder="Canvas course ID" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <Button type="submit" disabled={pending}>
          {pending ? 'Importing…' : 'Import roster'}
        </Button>
      </form>

      <p className="text-xs text-slate-500">
        Downloads active Student enrollments from Canvas. Re-importing updates students by GT ID;
        the Canvas user ID is retained for secure grade sync.
      </p>

      {state.errors?.length ? (
        <Notice tone={state.ok ? 'amber' : 'red'} title={state.ok ? 'Imported with warnings' : 'Import failed'}>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {state.errors.slice(0, 8).map((error) => (
              <li key={error}>{error}</li>
            ))}
            {state.errors.length > 8 ? <li>…and {state.errors.length - 8} more.</li> : null}
          </ul>
        </Notice>
      ) : null}

      {state.ok ? (
        <Notice tone="green" title={`Imported ${state.imported} students`}>
          <p className="mt-1">
            Excluded{' '}
            {state.excluded?.length
              ? state.excluded.map((e) => `${e.count} ${e.role}`).join(', ')
              : 'nobody'}
            . Sections: {state.sections?.map((s) => `${s.label} (${s.count})`).join(', ')}.
          </p>
          {state.dropped || state.restored ? (
            <p className="mt-1">
              {state.dropped
                ? `Removed ${state.dropped} student${state.dropped === 1 ? '' : 's'} no longer on this roster — their existing graded exams are kept.`
                : null}
              {state.dropped && state.restored ? ' ' : null}
              {state.restored
                ? `Restored ${state.restored} previously removed student${state.restored === 1 ? '' : 's'}.`
                : null}
            </p>
          ) : null}
        </Notice>
      ) : null}
    </div>
  )
}
