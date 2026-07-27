'use client'

import { useEffect, useState } from 'react'
import { Markdown, Textarea } from '@/components/ui'

/**
 * Markdown input with a live preview rendered by the same server pipeline the PDF
 * uses, so the editor is honestly WYSIWYG rather than an approximation.
 */
export function MarkdownField({
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
}) {
  const [html, setHtml] = useState('')

  useEffect(() => {
    if (!value.trim()) {
      setHtml('')
      return
    }

    // Debounced so a fast typist does not queue a render per keystroke.
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ markdown: value }),
          signal: controller.signal,
        })
        const data = (await response.json()) as { html: string }
        setHtml(data.html)
      } catch {
        // Aborted by the next keystroke, or the server hiccuped; the previous
        // preview stays on screen rather than flashing an error.
      }
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value])

  return (
    <div className="grid gap-2 md:grid-cols-2">
      <Textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <div className="min-h-[3rem] rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        {html ? (
          <Markdown html={html} />
        ) : (
          <span className="text-xs text-slate-400">Preview appears here</span>
        )}
      </div>
    </div>
  )
}
