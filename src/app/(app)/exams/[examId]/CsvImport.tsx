'use client'

import { useActionState } from 'react'
import { Button, Notice } from '@/components/ui'
import { importQuestionCsv, type CsvImportState } from './actions'

export function CsvImport({
  examId,
  questionId,
  hint,
}: {
  examId: string
  questionId?: string
  hint: string
}) {
  const [state, action, pending] = useActionState<CsvImportState, FormData>(importQuestionCsv, {})

  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="examId" value={examId} />
        {questionId ? <input type="hidden" name="questionId" value={questionId} /> : null}
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm file:mr-3 file:rounded-md file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-50"
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? 'Importing…' : 'Import CSV'}
        </Button>
      </form>

      <p className="text-xs text-slate-500">{hint}</p>

      {state.errors?.length ? (
        <Notice tone="red" title="Import failed">
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {state.errors.slice(0, 10).map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {state.ok ? <Notice tone="green">{state.message}</Notice> : null}

      {state.warnings?.length ? (
        <Notice tone="amber" title="Warnings">
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {state.warnings.slice(0, 10).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  )
}
