'use client'

import { useActionState, useState } from 'react'
import { Button, Notice } from '@/components/ui'
import type { SectionSummary } from '@/lib/sections'
import { syncCanvasSections, updateExcludedSections, type SectionSyncState } from './actions'

/**
 * Course-level section list and exclusions.
 *
 * The exclusion is a course setting rather than a per-run choice: a section that
 * does not sit this course's exams (a cross-listed graduate section, an audit
 * section) should be off every exam without anyone having to remember to untick it
 * on each generation run.
 */
export function SectionSettings({
  courseId,
  sections,
  canvasCourseId,
  excludedStudents,
}: {
  courseId: string
  sections: SectionSummary[]
  canvasCourseId: string | null
  excludedStudents: number
}) {
  const [excluded, setExcluded] = useState<string[]>(
    sections.filter((s) => s.excluded).map((s) => s.code),
  )
  const [sync, syncAction, syncing] = useActionState<SectionSyncState, FormData>(syncCanvasSections, {})

  const saved = sections.filter((s) => s.excluded).map((s) => s.code)
  const dirty = excluded.slice().sort().join(' ') !== saved.slice().sort().join(' ')

  return (
    <div className="space-y-3 border-t border-slate-100 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-600">Sections</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Tick a section to withhold it from every exam in this course. Already-generated runs
            are untouched.
          </p>
        </div>
        <form action={syncAction}>
          <input type="hidden" name="courseId" value={courseId} />
          <Button type="submit" variant="secondary" disabled={syncing || !canvasCourseId}>
            {syncing ? 'Syncing…' : 'Refresh from Canvas'}
          </Button>
        </form>
      </div>

      {sync.error ? <Notice tone="red" title="Could not refresh sections">{sync.error}</Notice> : null}
      {sync.ok ? (
        <Notice tone="green" title={`Found ${sync.found} section${sync.found === 1 ? '' : 's'} in Canvas`}>
          {sync.studentsUpdated
            ? `Renamed ${sync.relabelled} section code${sync.relabelled === 1 ? '' : 's'} on ${sync.studentsUpdated} student${sync.studentsUpdated === 1 ? '' : 's'}.`
            : 'Every section already carries its Canvas name.'}
        </Notice>
      ) : null}

      {sections.length === 0 ? (
        <p className="text-sm text-slate-500">No sections on the roster yet.</p>
      ) : (
        <form action={updateExcludedSections} className="space-y-3">
          <input type="hidden" name="courseId" value={courseId} />
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {sections.map((section) => {
              const checked = excluded.includes(section.code)
              return (
                <li key={section.code} className="flex items-center gap-3 px-3 py-2">
                  <input
                    id={`exclude-${section.code}`}
                    type="checkbox"
                    name="excluded"
                    value={section.code}
                    checked={checked}
                    onChange={(e) =>
                      setExcluded((prev) =>
                        e.target.checked ? [...prev, section.code] : prev.filter((c) => c !== section.code),
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <label htmlFor={`exclude-${section.code}`} className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className={`text-sm font-semibold ${checked ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                      {section.label}
                    </span>
                    <span className="truncate font-mono text-[10px] text-slate-400">{section.code}</span>
                  </label>
                  <span className="whitespace-nowrap text-xs text-slate-500">
                    {section.count} student{section.count === 1 ? '' : 's'}
                  </span>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center gap-3">
            <Button type="submit" variant="secondary" disabled={!dirty}>
              {dirty ? 'Save exclusions' : 'Exclusions saved'}
            </Button>
            {/* The saved figure is counted per student on the server, not summed
                from the section counts: a cross-listed student sits in two sections
                and must not be counted twice. */}
            <p className="text-xs text-slate-500">
              {dirty
                ? 'Unsaved changes.'
                : saved.length === 0
                  ? 'Every section sits every exam.'
                  : `${excludedStudents} student${excludedStudents === 1 ? '' : 's'} in ${saved.length} section${saved.length === 1 ? '' : 's'} are skipped when generating.`}
            </p>
          </div>
        </form>
      )}
    </div>
  )
}
