'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Polls the run's progress while it renders. A generation run is detached from the
 * request that started it, so the page reads `completedCount` from the database
 * rather than holding a stream open for the minutes a full class takes.
 */
export function RunProgress({
  runId,
  initialStatus,
  initialCompleted,
  total,
}: {
  runId: string
  initialStatus: string
  initialCompleted: number
  total: number
}) {
  const router = useRouter()
  const [status, setStatus] = useState(initialStatus)
  const [completed, setCompleted] = useState(initialCompleted)

  useEffect(() => {
    if (status === 'completed' || status === 'failed') return

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/runs/${runId}/progress`, { cache: 'no-store' })
        const data = (await response.json()) as { status: string; completedCount: number }
        setStatus(data.status)
        setCompleted(data.completedCount)

        // Pull the full page down once the artifacts exist.
        if (data.status === 'completed' || data.status === 'failed') router.refresh()
      } catch {
        // Transient; the next tick retries.
      }
    }, 1500)

    return () => clearInterval(timer)
  }, [runId, status, router])

  if (status === 'completed') return null

  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div className="px-5 py-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium">
          {status === 'failed' ? 'Generation failed' : 'Rendering exams…'}
        </span>
        <span className="text-slate-500">
          {completed} / {total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full transition-all ${status === 'failed' ? 'bg-red-500' : 'bg-slate-900'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {status !== 'failed' ? (
        <p className="mt-2 text-xs text-slate-500">
          The merged print file is assembled after the last student finishes. You can leave this page
          open; generation continues in the background.
        </p>
      ) : null}
    </div>
  )
}
