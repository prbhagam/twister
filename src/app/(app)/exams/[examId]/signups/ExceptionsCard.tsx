'use client'

import { Badge } from '@/components/ui'
import { byLastName } from '@/lib/roster'
import { updateBucketLabel } from './actions'

interface ExceptionStudent {
  id: string
  firstName: string
  lastName: string
  gtId: string | null
  username: string | null
}

interface ExceptionBucket {
  id: string
  rawLabel: string
  label: string | null
  rows: { student: ExceptionStudent }[]
}

export function ExceptionsCard({
  examId,
  buckets,
  canManage,
}: {
  examId: string
  buckets: ExceptionBucket[]
  canManage: boolean
}) {
  return (
    <ul className="divide-y divide-slate-100">
      {buckets.map((bucket) => (
        <ExceptionRow key={bucket.id} examId={examId} bucket={bucket} canManage={canManage} />
      ))}
    </ul>
  )
}

function ExceptionRow({ examId, bucket, canManage }: { examId: string; bucket: ExceptionBucket; canManage: boolean }) {
  const students = bucket.rows.map((r) => r.student).sort(byLastName)

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center gap-3" title={bucket.rawLabel}>
        <Badge tone="amber">{students.length}</Badge>
        {canManage ? (
          <form action={updateBucketLabel} className="flex flex-1 items-center gap-1.5">
            <input type="hidden" name="examId" value={examId} />
            <input type="hidden" name="bucketId" value={bucket.id} />
            <input
              name="label"
              defaultValue={bucket.label ?? ''}
              placeholder={bucket.rawLabel}
              className="min-w-48 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <button type="submit" className="rounded px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
              Save
            </button>
          </form>
        ) : (
          <span className="text-sm font-medium text-slate-900">{bucket.label || bucket.rawLabel}</span>
        )}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-900">
          {students.length} student{students.length === 1 ? '' : 's'} · full text: {bucket.rawLabel}
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
