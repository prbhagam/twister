'use client'

import { useActionState, useState } from 'react'
import { Button, Notice } from '@/components/ui'
import { startGeneration, type GenerateState } from './actions'

export function GeneratePanel({
  examId,
  sections,
  totalStudents,
  blocked,
  distinctExams,
}: {
  examId: string
  sections: { code: string; label: string; count: number }[]
  totalStudents: number
  blocked: boolean
  distinctExams: string
}) {
  const [state, action, pending] = useActionState<GenerateState, FormData>(startGeneration, {})
  const [selected, setSelected] = useState<string[]>([])

  const targetCount = selected.length
    ? sections.filter((s) => selected.includes(s.code)).reduce((n, s) => n + s.count, 0)
    : totalStudents

  return (
    <form action={action} className="space-y-4 px-5 py-4">
      <input type="hidden" name="examId" value={examId} />

      {state.error ? (
        <Notice tone="red" title="Cannot generate">
          <pre className="mt-1 whitespace-pre-wrap font-sans text-sm">{state.error}</pre>
        </Notice>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">
          Sections {selected.length === 0 ? '(all)' : `(${selected.length} selected)`}
        </p>
        {sections.length === 0 ? (
          <p className="text-sm text-slate-500">No roster imported for this course yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sections.map((section) => {
              const checked = selected.includes(section.code)
              return (
                <label
                  key={section.code}
                  className={`cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium ${
                    checked ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    name="sections"
                    value={section.code}
                    checked={checked}
                    onChange={(e) =>
                      setSelected((prev) =>
                        e.target.checked ? [...prev, section.code] : prev.filter((c) => c !== section.code),
                      )
                    }
                    className="sr-only"
                  />
                  {section.label} · {section.count}
                </label>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <p>
          Will generate <strong className="text-slate-900">{targetCount}</strong> exam
          {targetCount === 1 ? '' : 's'}, drawn from{' '}
          <strong className="text-slate-900">{distinctExams}</strong> possible distinct papers.
        </p>
        <p className="mt-1">
          Each run freezes a copy of every question, so editing questions afterwards cannot change
          what has already been printed.
        </p>
      </div>

      <Button type="submit" disabled={pending || blocked || targetCount === 0}>
        {pending ? 'Starting…' : `Generate ${targetCount} exam${targetCount === 1 ? '' : 's'}`}
      </Button>
      {blocked ? (
        <p className="text-xs text-red-700">Resolve the blocking issues above before generating.</p>
      ) : null}
    </form>
  )
}
