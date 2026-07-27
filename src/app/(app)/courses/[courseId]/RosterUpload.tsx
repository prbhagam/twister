'use client'

import { useActionState } from 'react'
import { Button, Notice } from '@/components/ui'
import { importRoster, type RosterImportState } from './actions'

export function RosterUpload({ courseId }: { courseId: string }) {
  const [state, action, pending] = useActionState<RosterImportState, FormData>(importRoster, {})

  return (
    <div className="space-y-3 px-5 py-4">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="courseId" value={courseId} />
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-50"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Importing…' : 'Import roster'}
        </Button>
      </form>

      <p className="text-xs text-slate-500">
        The GT export works as-is. Only rows with Role = Student are imported; re-importing updates
        existing students rather than duplicating them.
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
        </Notice>
      ) : null}
    </div>
  )
}
