'use client'

import { useState } from 'react'
import { Button, Input } from './ui'

/**
 * Destructive delete behind a typed confirmation.
 *
 * These deletes cascade a long way — a course takes its roster, every exam, every
 * generation run, all grades, and ~90 MB of PDFs per run with it — and there is no
 * undo. Typing the name is deliberately more friction than a confirm() dialog,
 * which is dismissed reflexively.
 */
export function DangerZone({
  action,
  hiddenFields,
  label,
  description,
  confirmWord,
  confirmHint,
  buttonText,
}: {
  action: (formData: FormData) => void | Promise<void>
  hiddenFields: Record<string, string>
  label: string
  description: string
  confirmWord: string
  confirmHint: string
  buttonText: string
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-red-700 underline hover:text-red-900"
      >
        {label}
      </button>
    )
  }

  return (
    <form action={action} className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3">
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <p className="text-xs text-red-900">{description}</p>
      <p className="text-xs text-red-900">
        {confirmHint} <code className="rounded bg-white px-1 font-mono">{confirmWord}</code>
      </p>

      <Input
        name="confirm"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={confirmWord}
        autoComplete="off"
        aria-label="Type to confirm deletion"
      />

      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={typed.trim() !== confirmWord}>
          {buttonText}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setOpen(false)
            setTyped('')
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
