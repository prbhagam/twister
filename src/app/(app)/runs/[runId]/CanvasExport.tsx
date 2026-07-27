'use client'

import { useState } from 'react'
import { MISSING_MARK } from '@/lib/export'

/**
 * Canvas gradebook download, with a choice about students who have no scanned
 * sheet. The two options are not cosmetic:
 *
 *  - included, marked MI — the file covers the whole roster, and Canvas is told
 *    something about every student;
 *  - omitted — Canvas leaves those students' existing grades untouched, which is
 *    what you want if you have already excused or scored them by hand.
 */
export function CanvasExport({
  runId,
  missingCount,
}: {
  runId: string
  missingCount: number
}) {
  const [submittedOnly, setSubmittedOnly] = useState(false)
  const href = `/api/runs/${runId}/canvas.csv${submittedOnly ? '?submittedOnly=1' : ''}`

  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <a href={href} className="block hover:opacity-80">
        <span className="text-sm font-medium text-slate-900">Canvas gradebook (CSV)</span>
        <span className="mt-0.5 block text-xs text-slate-500">Import via the Canvas gradebook</span>
      </a>

      {missingCount > 0 ? (
        <label className="mt-2 flex cursor-pointer items-start gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={submittedOnly}
            onChange={(e) => setSubmittedOnly(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Only students with submissions
            <span className="mt-0.5 block text-slate-500">
              {submittedOnly
                ? `Leaves out ${missingCount} student${missingCount === 1 ? '' : 's'} with no scanned sheet, so Canvas keeps whatever grade they already have.`
                : `Includes all students; the ${missingCount} with no scanned sheet get ${MISSING_MARK}.`}
            </span>
          </span>
        </label>
      ) : null}
    </div>
  )
}
