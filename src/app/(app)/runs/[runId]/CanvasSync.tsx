'use client'

import { useActionState } from 'react'
import { Button, Notice } from '@/components/ui'
import { syncCanvasGrades, type CanvasSyncState } from './actions'

export function CanvasSync({ runId, ready }: { runId: string; ready: boolean }) {
  const [state, action, pending] = useActionState<CanvasSyncState, FormData>(syncCanvasGrades, {})
  return (
    <div className="space-y-3 px-5 py-4">
      <p className="text-xs text-slate-500">Posts currently graded, Canvas-mapped results to one Canvas assignment. This changes Canvas grades.</p>
      <form action={action} className="space-y-2">
        <input type="hidden" name="runId" value={runId} />
        <input name="assignmentId" inputMode="numeric" required placeholder="Canvas assignment ID" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <input name="confirmation" required placeholder="Type PUSH to confirm" className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
        <Button type="submit" disabled={pending || !ready} className="w-full">{pending ? 'Syncing…' : 'Push grades to Canvas'}</Button>
      </form>
      {!ready ? <Notice tone="amber">Import a Gradescope result before syncing.</Notice> : null}
      {state.error ? <Notice tone="red">{state.error}</Notice> : null}
      {state.ok ? <Notice tone="green">Posted {state.synced} grades to Canvas.</Notice> : null}
    </div>
  )
}
