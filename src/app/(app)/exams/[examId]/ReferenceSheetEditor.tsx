'use client'

import { useState } from 'react'
import { Button } from '@/components/ui'
import { MarkdownField } from './questions/[questionId]/MarkdownField'
import { updateReferenceSheet } from './actions'

const PLACEHOLDER = `### grades.txt

\`\`\`text
Ross,88
Rachel,92
Monica,97
\`\`\`

### str methods

| Method | Returns |
|---|---|
| \`s.strip()\` | \`s\` without leading/trailing whitespace |
| \`s.split(",")\` | a list of the pieces between commas |`

/**
 * Markdown editor for the exam's reference sheet, with the same live preview the
 * question editor uses. Saved on its own, from its own form.
 */
export function ReferenceSheetEditor({ examId, initial }: { examId: string; initial: string }) {
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [pending, setPending] = useState(false)
  const dirty = value.trim() !== saved.trim()

  return (
    <form
      action={async (formData) => {
        setPending(true)
        try {
          await updateReferenceSheet(formData)
          setSaved(value)
        } finally {
          setPending(false)
        }
      }}
      className="space-y-3 px-5 py-4"
    >
      <input type="hidden" name="examId" value={examId} />
      <input type="hidden" name="referenceSheet" value={value} />
      <MarkdownField value={value} onChange={setValue} rows={14} placeholder={PLACEHOLDER} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {saved.trim()
            ? 'Printed at the back of every paper, starting on its own sheet so students can tear it off.'
            : 'No reference sheet. Leave empty to print none.'}{' '}
          Applies to runs generated after saving.
        </p>
        <Button type="submit" variant={dirty ? 'primary' : 'secondary'} disabled={pending || !dirty}>
          {pending ? 'Saving…' : dirty ? 'Save reference sheet' : 'Saved'}
        </Button>
      </div>
    </form>
  )
}
