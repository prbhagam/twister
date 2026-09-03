'use client'

import { useActionState } from 'react'
import { Button, Input, Notice } from '@/components/ui'
import { syncSignupSheet, type SignupSyncState } from './actions'

export function SignupSheetPanel({
  examId,
  initialUrl,
  canManage,
}: {
  examId: string
  initialUrl: string
  canManage: boolean
}) {
  const [state, action, pending] = useActionState<SignupSyncState, FormData>(syncSignupSheet, {})

  return (
    <div className="space-y-3 px-5 py-4">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="examId" value={examId} />
        <input
          name="signupSheetUrl"
          defaultValue={initialUrl}
          placeholder="https://docs.google.com/spreadsheets/d/…"
          disabled={!canManage}
          className="min-w-64 flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-500"
        />
        <Button type="submit" disabled={pending || !canManage}>
          {pending ? 'Syncing…' : 'Sync now'}
        </Button>
      </form>

      <p className="text-xs text-slate-500">
        Reads the sheet&apos;s first tab for student sign-ups (GTID, FirstName, LastName, CanvasUserId,
        SignupSlot) and a tab named &quot;Slots&quot; for session capacity (Date, Time, Room, Capacity).
        Re-syncing always reflects the sheet as it is right now.
      </p>

      {state.error ? <Notice tone="red" title="Sync failed">{state.error}</Notice> : null}

      {state.ok ? (
        <Notice tone="green" title={`Synced ${state.matchedCount} of ${state.rowCount} rows`}>
          {state.unmatched?.length ? (
            <p className="mt-1">{state.unmatched.length} row(s) did not match a roster student — see above.</p>
          ) : null}
          {state.warnings?.length ? <p className="mt-1">{state.warnings.length} warning(s) — see above.</p> : null}
        </Notice>
      ) : null}
    </div>
  )
}
