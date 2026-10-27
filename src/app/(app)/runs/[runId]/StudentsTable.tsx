'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Badge, CardHeader, Empty } from '@/components/ui'
import {
  ALL,
  FIRST_DIRECTION,
  arrangeRows,
  sectionOptions as listSections,
  sessionOptions as listSessions,
  type Direction,
  type SortKey,
  type StudentTableRow,
} from '@/lib/student-table'

export interface StudentRow extends StudentTableRow {
  /** Absent when the row could not be tied to a student exam; then it has no link. */
  studentExamId?: string
  name: string
  identifier: string | null
  traceCode: string
  blankLabel?: string
}

const SELECT =
  'max-w-[14rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-slate-500 focus:outline-none'

/**
 * The run's students, sortable by name, score, or flags and filterable by
 * section and sign-up session. The ordering rules live in lib/student-table.ts.
 */
export function StudentsTable({ runId, rows }: { runId: string; rows: StudentRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: Direction }>({ key: 'name', direction: 'asc' })
  const [section, setSection] = useState(ALL)
  const [session, setSession] = useState(ALL)
  const filtered = section !== ALL || session !== ALL

  const sectionOptions = useMemo(() => listSections(rows), [rows])
  const sessionOptions = useMemo(() => listSessions(rows), [rows])
  const visible = useMemo(() => arrangeRows(rows, sort, { section, session }), [rows, sort, section, session])

  const graded = visible.filter((row) => row.status === 'graded')
  const average = graded.length
    ? graded.reduce((sum, row) => sum + (row.possible > 0 ? row.earned / row.possible : 0), 0) / graded.length
    : null
  const flags = graded.reduce((n, row) => n + row.flags, 0)
  const anyGraded = rows.some((row) => row.status === 'graded')

  const subtitle = !anyGraded
    ? 'Not graded yet'
    : [
        filtered ? `${visible.length} of ${rows.length} students` : null,
        average === null ? 'No graded students' : `Average ${(average * 100).toFixed(1)}%`,
        `${flags} unresolved flag${flags === 1 ? '' : 's'}`,
      ]
        .filter(Boolean)
        .join(' · ')

  const toggle = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: FIRST_DIRECTION[key] },
    )

  const header = (key: SortKey, label: string, align: 'left' | 'right', className: string) => {
    const active = sort.key === key
    const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
    return (
      <th className={`${className} font-medium`} aria-sort={ariaSort}>
        <button
          type="button"
          onClick={() => toggle(key)}
          className={`inline-flex items-center gap-1 hover:text-slate-900 ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-slate-900' : ''}`}
        >
          {label}
          <span aria-hidden className={`text-[10px] ${active ? '' : 'invisible'}`}>
            {sort.direction === 'asc' ? '▲' : '▼'}
          </span>
        </button>
      </th>
    )
  }

  return (
    <>
      <CardHeader
        title="Students"
        subtitle={subtitle}
        action={
          sectionOptions.length > 1 || sessionOptions.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1.5 text-xs text-slate-500">
              {sectionOptions.length > 1 ? (
                <label className="flex items-center gap-1.5">
                  Section
                  <select value={section} onChange={(e) => setSection(e.target.value)} className={SELECT}>
                    <option value={ALL}>All ({rows.length})</option>
                    {sectionOptions.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label} ({s.count})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {sessionOptions.length > 0 ? (
                <label className="flex items-center gap-1.5">
                  Session
                  <select value={session} onChange={(e) => setSession(e.target.value)} className={SELECT}>
                    <option value={ALL}>All ({rows.length})</option>
                    {sessionOptions.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label} ({s.count})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {filtered ? (
                <button
                  type="button"
                  onClick={() => {
                    setSection(ALL)
                    setSession(ALL)
                  }}
                  className="text-slate-600 underline hover:text-slate-900"
                >
                  Clear
                </button>
              ) : null}
            </div>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <Empty>No students in this run.</Empty>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                {header('name', 'Student', 'left', 'px-5 py-2 text-left')}
                <th className="px-3 py-2 text-left font-medium">GT ID</th>
                <th className="px-3 py-2 text-left font-medium">Code</th>
                {header('score', 'Score', 'right', 'px-3 py-2 text-right')}
                {header('flags', 'Flags', 'right', 'px-5 py-2 text-right')}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50">
                  <td className="px-5 py-1.5">
                    {row.studentExamId ? (
                      <Link href={`/runs/${runId}/students/${row.studentExamId}`} className="hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      row.name
                    )}
                    {row.blankLabel ? (
                      <span className="ml-2">
                        <Badge tone="amber">abnormal · {row.blankLabel}</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{row.identifier ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-slate-400">{row.traceCode}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.status === 'not_taken' ? (
                      <span className="text-xs text-slate-400">not taken</span>
                    ) : (
                      <>
                        {row.earned}
                        <span className="text-slate-400">/{row.possible}</span>
                      </>
                    )}
                  </td>
                  <td className="px-5 py-1.5 text-right">{row.flags > 0 ? <Badge tone="amber">{row.flags}</Badge> : null}</td>
                </tr>
              ))}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">
                    No students match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
