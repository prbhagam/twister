'use client'

import { useActionState } from 'react'
import { Button, Input, Label, Notice } from '@/components/ui'
import { assignBlankExam, clearBlankExam, type BlankAssignState } from './actions'

export interface AttendanceStudent {
  studentExamId: string
  name: string
  identity: string
}

export interface AttendanceAssignment extends AttendanceStudent {
  blankLabel: string
  sessionName: string
}

/**
 * Records students who sat a session other than the one they signed up for,
 * on one of that session's blank exams. The TA wrote the blank's number next to
 * the student's name on the session roster; entering it here is what makes the
 * student's answers grade against the paper they actually held.
 */
export function AbnormalAttendance({
  runId,
  students,
  assignments,
  blanksIssued,
}: {
  runId: string
  students: AttendanceStudent[]
  assignments: AttendanceAssignment[]
  blanksIssued: number
}) {
  const [state, action, pending] = useActionState<BlankAssignState, FormData>(assignBlankExam, {})

  return (
    <div className="space-y-3 px-5 py-4">
      {blanksIssued === 0 ? (
        <p className="text-xs text-slate-500">
          No blank exams have been issued for this run yet. Each session folder of{' '}
          <span className="font-medium">Exams by session (ZIP)</span> gets three, created the first
          time you download it.
        </p>
      ) : (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="runId" value={runId} />
          <div className="min-w-56 flex-1">
            <Label htmlFor="abnormal-student">Student</Label>
            <select
              id="abnormal-student"
              name="studentExamId"
              required
              defaultValue=""
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
            >
              <option value="" disabled>
                Choose a student…
              </option>
              {students.map((s) => (
                <option key={s.studentExamId} value={s.studentExamId}>
                  {s.name} — {s.identity}
                </option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <Label htmlFor="abnormal-blank">Blank exam ID</Label>
            <Input id="abnormal-blank" name="blank" required placeholder="BLANK-07" autoComplete="off" />
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? 'Saving…' : 'Mark abnormal'}
          </Button>
        </form>
      )}

      {blanksIssued > 0 ? (
        <p className="text-xs text-slate-500">
          The student is regraded against the blank straight away, and any manual overrides they
          had are cleared, since those were entered against their original paper.
        </p>
      ) : null}

      {state.error ? <Notice tone="red">{state.error}</Notice> : null}
      {state.ok && state.message ? <Notice tone="green">{state.message}</Notice> : null}

      {assignments.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
          {assignments.map((a) => (
            <li key={a.studentExamId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>
                {a.name} <span className="font-mono text-xs text-slate-500">{a.identity}</span>
                <span className="block text-xs text-slate-500">
                  on <code className="font-mono">{a.blankLabel}</code> from {a.sessionName}
                </span>
              </span>
              <form action={clearBlankExam}>
                <input type="hidden" name="runId" value={runId} />
                <input type="hidden" name="studentExamId" value={a.studentExamId} />
                <button type="submit" className="text-xs font-medium text-slate-600 underline hover:text-slate-900">
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
