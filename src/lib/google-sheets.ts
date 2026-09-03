import Papa from 'papaparse'
import { candidateKeys, matchKeys } from './identity'

/**
 * Imports an exam's session sign-ups from a Google Sheet the instructor
 * maintains outside TWISTER. The sheet must be shared "Anyone with the link can
 * view" — everything here is a plain, unauthenticated HTTP fetch of Google's own
 * CSV export endpoints, the same access a browser gets with no Google login.
 *
 * Two tabs matter:
 *  - the first (default) tab: one row per student, with a SignupSlot cell that
 *    is either "Not signed up", a "M/D/YYYY h:mm AM/PM (Location)" session
 *    string, or a free-text "Exception: ..." sentence exempting that student;
 *  - a tab named "Slots": the canonical session list and room capacity, fetched
 *    by name (not gid) via the gviz endpoint, which also works with no auth.
 */

// --- URL handling -------------------------------------------------------------

/** Pulls the spreadsheet id out of any pasted Google Sheets URL, or accepts a
 * bare id typed directly. Returns null (never throws) so the caller can show a
 * field-level error instead of a stack trace. */
export function extractSpreadsheetId(pastedUrl: string): string | null {
  const value = pastedUrl.trim()
  if (!value) return null
  const match = value.match(/\/d\/([a-zA-Z0-9_-]{20,})/)
  if (match) return match[1]
  if (/^[a-zA-Z0-9_-]{20,}$/.test(value)) return value
  return null
}

export function buildSheetCsvUrls(spreadsheetId: string): { mainTabUrl: string; slotsTabUrl: string } {
  return {
    mainTabUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`,
    slotsTabUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=Slots`,
  }
}

/**
 * Fetches one tab as CSV text. Google serves an HTML sign-in/permission page
 * instead of an error status when a sheet is not actually link-shared, so that
 * has to be detected explicitly rather than left to trip up the CSV parser with
 * a confusing downstream error.
 */
async function fetchSheetCsv(url: string, label: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Could not fetch the ${label} (HTTP ${response.status}).`)
  }
  const body = await response.text()
  const looksLikeHtml =
    /^\s*<!DOCTYPE|^\s*<html/i.test(body) || (response.headers.get('content-type') ?? '').includes('text/html')
  if (looksLikeHtml) {
    throw new Error(
      `The ${label} did not return spreadsheet data — make sure the sheet is shared as ` +
        `"Anyone with the link can view", and that the link points at the right spreadsheet.`,
    )
  }
  return body
}

// --- shared date/time parsing --------------------------------------------------

const MONTHS = { min: 1, max: 12 }

function normalizeYear(raw: string): number {
  const year = Number(raw)
  return raw.length <= 2 ? 2000 + year : year
}

/** "1:35" + "PM" -> 24-hour {hour, minute}. */
function to24Hour(hourRaw: string, minuteRaw: string, ampmRaw: string): { hour: number; minute: number } {
  let hour = Number(hourRaw) % 12
  if (ampmRaw.toUpperCase() === 'PM') hour += 12
  return { hour, minute: Number(minuteRaw) }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** The idempotency key shared between a Tab-1 session string and its Tab-2
 * Slots-tab row, so "10/27/2026" and "10/27/26" collapse onto the same session. */
function sessionNaturalKey(year: number, month: number, day: number, hour: number, minute: number, room: string): string {
  return `${year}-${pad(month)}-${pad(day)}|${pad(hour)}:${pad(minute)}|${room.trim().toLowerCase()}`
}

// --- Tab 2: Slots (capacity) ---------------------------------------------------

export interface SlotRow {
  naturalKey: string
  room: string
  capacity: number | null
}

function findField(fields: string[], ...names: string[]): string | undefined {
  const lower = names.map((n) => n.toLowerCase())
  return fields.find((f) => lower.includes(f.trim().toLowerCase()))
}

/** "10/26/26" + "8:00 AM" -> the same naturalKey a matching Tab-1 session string
 * would produce. Returns null for a row that doesn't parse as a date; the row is
 * then simply left out of the slot list rather than failing the whole import. */
function parseSlotDateTime(dateRaw: string, timeRaw: string, room: string): string | null {
  const dateMatch = dateRaw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  const timeMatch = timeRaw.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!dateMatch || !timeMatch) return null
  const [, monthRaw, dayRaw, yearRaw] = dateMatch
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (month < MONTHS.min || month > MONTHS.max || day < 1 || day > 31) return null
  const year = normalizeYear(yearRaw)
  const [, hourRaw, minuteRaw, ampmRaw] = timeMatch
  const { hour, minute } = to24Hour(hourRaw, minuteRaw, ampmRaw)
  return sessionNaturalKey(year, month, day, hour, minute, room)
}

/**
 * Parses the "Slots" tab: Date, Time, Room, Capacity columns (case-insensitive,
 * tolerant of column order — this is a hand-typed sheet, not a generated export).
 * A missing/empty Slots tab is not fatal here — the caller demotes that to a
 * warning, since every session bucket still exists with capacity left null.
 */
export function parseSlotsCsv(csv: string): { slots: SlotRow[]; errors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^﻿/, '').trim(),
  })

  const fields = parsed.meta.fields ?? []
  const dateField = findField(fields, 'date')
  const timeField = findField(fields, 'time')
  const roomField = findField(fields, 'room')
  const capacityField = findField(fields, 'capacity')

  if (!dateField || !timeField || !roomField) {
    return { slots: [], errors: ['The Slots tab is missing a Date, Time, or Room column.'] }
  }

  const slots: SlotRow[] = []
  for (const row of parsed.data) {
    const room = (row[roomField] ?? '').trim()
    if (!room) continue
    const naturalKey = parseSlotDateTime(row[dateField] ?? '', row[timeField] ?? '', room)
    if (!naturalKey) continue
    const capacityRaw = capacityField ? (row[capacityField] ?? '').trim() : ''
    const capacity = capacityRaw && Number.isFinite(Number(capacityRaw)) ? Number(capacityRaw) : null
    slots.push({ naturalKey, room, capacity })
  }
  return { slots, errors: [] }
}

export function matchSlotForSession(naturalKey: string, slots: SlotRow[]): SlotRow | null {
  return slots.find((s) => s.naturalKey === naturalKey) ?? null
}

// --- Tab 1: the sign-up sheet itself -------------------------------------------

export type SignupBucketKind = 'session' | 'exception' | 'not_signed_up'

export interface ClassifiedSlot {
  kind: SignupBucketKind
  naturalKey: string
  rawLabel: string
  sessionAt: Date | null
  location: string | null
}

const SESSION_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(([^)]+)\)$/i

/**
 * Classifies one SignupSlot cell. A string that fails to parse as a session is
 * never dropped — it is bucketed like an exception (grouped by its own exact
 * text) so nothing a student typed or a formula produced silently disappears;
 * the caller adds a warning noting the unparsed string.
 */
export function classifySignupSlot(raw: string): ClassifiedSlot {
  const trimmed = raw.trim()

  if (/^not[\s-]?signed[\s-]?up$/i.test(trimmed)) {
    return { kind: 'not_signed_up', naturalKey: 'not_signed_up', rawLabel: trimmed || 'Not signed up', sessionAt: null, location: null }
  }

  const sessionMatch = trimmed.match(SESSION_RE)
  if (sessionMatch) {
    const [, monthRaw, dayRaw, yearRaw, hourRaw, minuteRaw, ampmRaw, locationRaw] = sessionMatch
    const month = Number(monthRaw)
    const day = Number(dayRaw)
    const year = normalizeYear(yearRaw)
    const { hour, minute } = to24Hour(hourRaw, minuteRaw, ampmRaw)
    const location = locationRaw.trim()
    return {
      kind: 'session',
      naturalKey: sessionNaturalKey(year, month, day, hour, minute, location),
      rawLabel: trimmed,
      sessionAt: new Date(year, month - 1, day, hour, minute),
      location,
    }
  }

  // "Exception: ..." and anything else unparsed both land here, grouped by their
  // own exact text — deliberately generic, never hardcoded to specific wording.
  const naturalKey = trimmed.toLowerCase().replace(/\s+/g, ' ')
  return { kind: 'exception', naturalKey, rawLabel: trimmed, sessionAt: null, location: null }
}

export interface ParsedSignupRow {
  gtId: string
  canvasUserId: string
  firstName: string
  lastName: string
  rawSignupSlot: string
  classified: ClassifiedSlot
}

/**
 * Parses the main sign-up tab: GTID, FirstName, LastName, CanvasUserId,
 * SignupSlot columns (case-insensitive column names).
 */
export function parseSignupSheetCsv(csv: string): { rows: ParsedSignupRow[]; errors: string[]; warnings: string[] } {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^﻿/, '').trim(),
  })

  const fields = parsed.meta.fields ?? []
  const gtIdField = findField(fields, 'gtid', 'gt id')
  const firstField = findField(fields, 'firstname', 'first name')
  const lastField = findField(fields, 'lastname', 'last name')
  const canvasField = findField(fields, 'canvasuserid', 'canvas user id')
  const slotField = findField(fields, 'signupslot', 'signup slot')

  const missing = [
    !gtIdField && 'GTID',
    !firstField && 'FirstName',
    !lastField && 'LastName',
    !canvasField && 'CanvasUserId',
    !slotField && 'SignupSlot',
  ].filter((x): x is string => Boolean(x))
  if (missing.length) {
    return { rows: [], errors: [`Sheet is missing required column(s): ${missing.join(', ')}.`], warnings: [] }
  }

  const rows: ParsedSignupRow[] = []
  const warnings: string[] = []
  const unparsedSeen = new Set<string>()
  for (const row of parsed.data) {
    const gtId = (row[gtIdField!] ?? '').trim()
    if (!gtId) continue
    const rawSignupSlot = (row[slotField!] ?? '').trim()
    const classified = classifySignupSlot(rawSignupSlot)
    if (classified.kind === 'exception' && !/^exception:/i.test(rawSignupSlot) && !unparsedSeen.has(rawSignupSlot)) {
      unparsedSeen.add(rawSignupSlot)
      warnings.push(`Could not parse signup slot "${rawSignupSlot}" as a session; grouped as its own exception.`)
    }
    rows.push({
      gtId,
      canvasUserId: (row[canvasField!] ?? '').trim(),
      firstName: (row[firstField!] ?? '').trim(),
      lastName: (row[lastField!] ?? '').trim(),
      rawSignupSlot,
      classified,
    })
  }
  return { rows, errors: [], warnings }
}

/** Rough starting point only — a select-all-that-apply-style default the
 * instructor is expected to rename via the dashboard, not a smart summary. */
export function deriveDefaultLabel(rawExceptionText: string): string {
  const body = rawExceptionText.replace(/^exception:\s*/i, '').trim()
  if (body.length <= 40) return body
  return `${body.slice(0, 40).replace(/\s+\S*$/, '')}…`
}

// --- putting it together -------------------------------------------------------

export interface SignupSheetFetchResult {
  rows: ParsedSignupRow[]
  slots: SlotRow[]
  errors: string[]
  warnings: string[]
}

export async function fetchAndParseSignupSheet(sheetUrl: string): Promise<SignupSheetFetchResult> {
  const id = extractSpreadsheetId(sheetUrl)
  if (!id) {
    return { rows: [], slots: [], errors: ['Could not find a spreadsheet ID in that link.'], warnings: [] }
  }
  const { mainTabUrl, slotsTabUrl } = buildSheetCsvUrls(id)

  // One tab failing should not hide the other's result.
  const [mainResult, slotsResult] = await Promise.allSettled([
    fetchSheetCsv(mainTabUrl, 'sign-up sheet'),
    fetchSheetCsv(slotsTabUrl, '"Slots" tab'),
  ])

  if (mainResult.status === 'rejected') {
    return { rows: [], slots: [], errors: [mainResult.reason instanceof Error ? mainResult.reason.message : String(mainResult.reason)], warnings: [] }
  }
  const parsedMain = parseSignupSheetCsv(mainResult.value)
  if (parsedMain.errors.length) {
    return { rows: [], slots: [], errors: parsedMain.errors, warnings: [] }
  }

  const warnings = [...parsedMain.warnings]
  let slots: SlotRow[] = []
  if (slotsResult.status === 'rejected') {
    warnings.push(
      `Could not read the "Slots" tab (${slotsResult.reason instanceof Error ? slotsResult.reason.message : String(slotsResult.reason)}) — session capacity will need to be set manually.`,
    )
  } else {
    const parsedSlots = parseSlotsCsv(slotsResult.value)
    slots = parsedSlots.slots
    if (parsedSlots.errors.length || slots.length === 0) {
      warnings.push('No usable rows found in the "Slots" tab — session capacity will need to be set manually.')
    }
  }

  return { rows: parsedMain.rows, slots, errors: [], warnings }
}

// --- matching sheet rows to roster Students -------------------------------------

export interface SignupMatchReport {
  matched: { studentId: string; row: ParsedSignupRow; matchedOn: 'gtId' | 'canvasUserId' }[]
  unmatched: { gtId: string; canvasUserId: string; name: string; signupSlot: string }[]
}

/**
 * Matches each parsed sheet row to a roster Student, preferring GTID (the
 * sheet's stated join key) and falling back to CanvasUserId — the same
 * union-of-identifiers approach grading.ts's matchStudents uses for Gradescope.
 */
export function matchSignupRows(
  rows: ParsedSignupRow[],
  rosterStudents: { id: string; gtId?: string | null; canvasUserId?: string | null }[],
): SignupMatchReport {
  const index = new Map<string, string>() // key -> studentId
  for (const student of rosterStudents) {
    for (const key of matchKeys(student)) {
      if (!index.has(key)) index.set(key, student.id)
    }
  }

  const matched: SignupMatchReport['matched'] = []
  const unmatched: SignupMatchReport['unmatched'] = []

  for (const row of rows) {
    const byGtId = candidateKeys(row.gtId)
      .map((key) => index.get(key))
      .find(Boolean)
    const byCanvasId = byGtId
      ? undefined
      : candidateKeys(row.canvasUserId)
          .map((key) => index.get(key))
          .find(Boolean)
    const studentId = byGtId ?? byCanvasId

    if (studentId) {
      matched.push({ studentId, row, matchedOn: byGtId ? 'gtId' : 'canvasUserId' })
    } else {
      unmatched.push({
        gtId: row.gtId,
        canvasUserId: row.canvasUserId,
        name: `${row.firstName} ${row.lastName}`.trim(),
        signupSlot: row.rawSignupSlot,
      })
    }
  }

  return { matched, unmatched }
}
