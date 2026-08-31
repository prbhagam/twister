const DEFAULT_BASE_URL = 'https://gatech.instructure.com'

function canvasConfig() {
  const token = process.env.CANVAS_API_TOKEN?.trim()
  if (!token) throw new Error('Canvas is not configured. Set CANVAS_API_TOKEN in .env and restart the app.')
  const baseUrl = (process.env.CANVAS_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  return { token, baseUrl }
}

async function canvasFetch(pathOrUrl: string, init?: RequestInit) {
  const { token, baseUrl } = canvasConfig()
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl}${pathOrUrl}`
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Canvas request failed (${response.status}). Check the course, assignment, token permissions, and Canvas availability.`)
  return response
}

function nextLink(header: string | null) {
  if (!header) return null
  return header.split(',').map((part) => part.trim()).find((part) => /rel="next"/.test(part))?.match(/<([^>]+)>/)?.[1] ?? null
}

export interface CanvasEnrollment {
  user?: { id?: number | string; name?: string; sortable_name?: string; login_id?: string; sis_user_id?: string; primary_email?: string }
  user_id?: number | string
  course_section_id?: number | string
}

export interface CanvasUserProfile {
  id?: number | string
  name?: string
  sortable_name?: string
  login_id?: string
  sis_user_id?: string
  primary_email?: string
  email?: string
}

async function canvasPages<T>(firstUrl: string, what: string): Promise<T[]> {
  let url: string | null = firstUrl
  const rows: T[] = []
  while (url) {
    const response = await canvasFetch(url)
    const page: unknown = await response.json()
    if (!Array.isArray(page)) throw new Error(`Canvas returned an unexpected ${what} response.`)
    rows.push(...page.filter((item): item is T => Boolean(item && typeof item === 'object')))
    url = nextLink(response.headers.get('link'))
  }
  return rows
}

export async function fetchCanvasRoster(canvasCourseId: string): Promise<CanvasEnrollment[]> {
  return canvasPages<CanvasEnrollment>(
    `/api/v1/courses/${encodeURIComponent(canvasCourseId)}/enrollments?type[]=StudentEnrollment&state[]=active&include[]=user&per_page=100`,
    'roster',
  )
}

/** Enrollment `user` objects omit the login/email fields, and `/users/:id/profile`
 * is 403 for anyone without account-admin rights — a teacher token can only read
 * its own profile. The course users list, however, honours `include[]=email` for
 * every student a teacher can see, so it is the reliable identity source. */
export async function fetchCanvasCourseUsers(canvasCourseId: string): Promise<CanvasUserProfile[]> {
  return canvasPages<CanvasUserProfile>(
    `/api/v1/courses/${encodeURIComponent(canvasCourseId)}/users?enrollment_type[]=student&enrollment_state[]=active&include[]=email&per_page=100`,
    'course users',
  )
}

/** Enrollment responses can omit login/SIS fields even when the token is allowed
 * to read them. The user-profile endpoint provides the canonical identity data. */
export async function fetchCanvasUserProfile(canvasUserId: string): Promise<CanvasUserProfile> {
  const response = await canvasFetch(`/api/v1/users/${encodeURIComponent(canvasUserId)}/profile`)
  const profile: unknown = await response.json()
  if (!profile || typeof profile !== 'object') throw new Error('Canvas returned an unexpected student profile response.')
  return profile as CanvasUserProfile
}

/** `grade` is Canvas's `posted_grade`, which accepts a number, a percentage, a
 * letter grade, or `EX` to excuse. Anything else — `MI` included — is rejected by
 * Canvas, so callers must be prepared for a per-student failure. */
export async function postCanvasGrade(params: { courseId: string; assignmentId: string; studentCanvasUserId: string; grade: number | string }) {
  const body = new URLSearchParams({ 'submission[posted_grade]': String(params.grade) })
  await canvasFetch(
    `/api/v1/courses/${encodeURIComponent(params.courseId)}/assignments/${encodeURIComponent(params.assignmentId)}/submissions/${encodeURIComponent(params.studentCanvasUserId)}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
  )
}
