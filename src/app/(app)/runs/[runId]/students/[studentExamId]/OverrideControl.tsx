'use client'

import { useState } from 'react'
import { Button, Input } from '@/components/ui'
import { setOverride } from '../../actions'

/**
 * Manual score override for a flagged question — a faint mark the scanner missed, a
 * bubble the student erased, a question thrown out after the fact.
 *
 * Overrides are stored against the StudentExam, not the grading import, so
 * re-importing a corrected Gradescope CSV does not wipe them.
 */
export function OverrideControl({
  runId,
  studentExamId,
  position,
  possible,
  current,
  note,
}: {
  runId: string
  studentExamId: string
  position: number
  possible: number
  current: number | null
  note: string
}) {
  const [open, setOpen] = useState(false)

  if (!open && current === null) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-slate-700 underline hover:text-slate-900"
      >
        Override score
      </button>
    )
  }

  return (
    <form action={setOverride} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="studentExamId" value={studentExamId} />
      <input type="hidden" name="position" value={position} />

      <Input
        name="awarded"
        type="number"
        step="0.5"
        min="0"
        max={possible}
        defaultValue={current ?? possible}
        className="w-16"
        aria-label="Points awarded"
      />
      <span className="text-slate-400">/ {possible}</span>
      <Input name="note" defaultValue={note} placeholder="Reason (optional)" className="w-44" />
      <Button type="submit" variant="secondary" className="px-2 py-1 text-xs">
        Save
      </Button>
      {current !== null ? (
        <Button
          type="submit"
          name="clear"
          value="1"
          variant="danger"
          className="px-2 py-1 text-xs"
          formNoValidate
        >
          Clear
        </Button>
      ) : null}
    </form>
  )
}
