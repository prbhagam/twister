'use client'

import { Badge } from '@/components/ui'
import { byLastName } from '@/lib/roster'
import { updateBucketCapacity } from './actions'

interface SessionStudent {
  id: string
  firstName: string
  lastName: string
  gtId: string | null
  username: string | null
}

interface SessionBucket {
  id: string
  rawLabel: string
  capacity: number | null
  rows: { student: SessionStudent }[]
}

export function SessionsCard({
  examId,
  buckets,
  canManage,
}: {
  examId: string
  buckets: SessionBucket[]
  canManage: boolean
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {buckets.map((bucket) => (
        <SessionRow key={bucket.id} examId={examId} bucket={bucket} canManage={canManage} />
      ))}
    </ul>
  )
}

function SessionRow({ examId, bucket, canManage }: { examId: string; bucket: SessionBucket; canManage: boolean }) {
  const filled = bucket.rows.length
  const over = bucket.capacity != null && filled > bucket.capacity
  const students = bucket.rows.map((r) => r.student).sort(byLastName)

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-900">{bucket.rawLabel}</span>
        <Badge tone={over ? 'red' : 'neutral'}>
          {filled}/{bucket.capacity ?? '—'}
        </Badge>
        {canManage ? (
          <form action={updateBucketCapacity} className="flex items-center gap-1.5">
            <input type="hidden" name="examId" value={examId} />
            <input type="hidden" name="bucketId" value={bucket.id} />
            <input
              type="number"
              name="capacity"
              min="0"
              defaultValue={bucket.capacity ?? ''}
              placeholder="capacity"
              className="w-20 rounded border border-slate-300 px-1.5 py-0.5 text-xs"
            />
            <button type="submit" className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
              Save
            </button>
          </form>
        ) : null}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-900">
          {filled} student{filled === 1 ? '' : 's'}
        </summary>
        <ul className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-100">
          {students.map((s) => (
            <li key={s.id} className="px-3 py-1 text-sm">
              {s.lastName}, {s.firstName}
              <span className="ml-2 font-mono text-xs text-slate-400">{s.gtId ?? s.username ?? ''}</span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}
