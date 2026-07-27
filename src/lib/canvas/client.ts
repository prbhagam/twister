/**
 * Minimal Canvas LMS REST client.
 *
 * The token is a Canvas *personal access token*, which cannot be scoped: it carries
 * the full permissions of the user who minted it, across every course they can
 * reach, including writing grades. It is therefore read from server environment
 * only, is never persisted to the database, and must never be returned to a
 * browser. Everything in this module is server-side by construction.
 */

export interface CanvasConfig {
  baseUrl: string
  token: string
}

export class CanvasError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message)
    this.name = 'CanvasError'
  }
}

export interface CanvasUser {
  id: number
  name: string
  sortable_name?: string
  /** The GT ID. Only present if the token's role may see SIS identifiers. */
  sis_user_id?: string | null
  login_id?: string | null
  email?: string | null
  enrollments?: { course_section_id: number; type: string; enrollment_state: string }[]
}

export interface CanvasSection {
  id: number
  name: string
  sis_section_id?: string | null
}

export interface CanvasCourse {
  id: number
  name: string
  course_code?: string
  term?: { name?: string }
  /** The current user's own enrolments in this course. */
  enrollments?: { type: string; role?: string; enrollment_state?: string }[]
}

/**
 * Roles that imply running a course rather than taking it. TA is included
 * deliberately: head TAs routinely administer exams, and filtering to `teacher`
 * alone silently hides every course they support.
 */
const STAFF_ENROLLMENTS = new Set(['teacher', 'ta', 'designer'])

export function staffRoleFor(course: CanvasCourse): string | null {
  const roles = (course.enrollments ?? [])
    .filter((e) => STAFF_ENROLLMENTS.has(e.type))
    .map((e) => e.type)
  if (roles.length === 0) return null
  // Prefer the most privileged label when someone holds several.
  return ['teacher', 'designer', 'ta'].find((r) => roles.includes(r)) ?? roles[0]
}

export interface CanvasAssignment {
  id: number
  name: string
  points_possible: number | null
  published: boolean
  post_manually?: boolean
}

export interface CanvasSubmission {
  user_id: number
  score: number | null
  grade: string | null
  workflow_state: string
}

/**
 * How a student is addressed in Canvas's SIS-prefixed id syntax.
 *   sis_user_id  -> the GT ID  (903000101)
 *   sis_login_id -> the GT account (mbello3)
 */
export type GradeKeyKind = 'sis_user_id' | 'sis_login_id'

export interface CanvasProgress {
  id: number
  workflow_state: 'queued' | 'running' | 'completed' | 'failed'
  completion: number | null
  message?: string | null
}

/**
 * Turns a Canvas path into what it was actually trying to do, so a 403 names the
 * operation rather than "this request". The push touches four endpoints at once and
 * "permission denied" is useless without knowing which.
 */
function describeEndpoint(path: string): string {
  if (path.endsWith('/submissions')) return 'reading existing grades for this assignment'
  if (path.includes('/update_grades')) return 'writing grades to this assignment'
  if (path.endsWith('/assignments')) return 'listing this course’s assignments'
  if (path.endsWith('/users')) return 'listing this course’s students'
  if (path.endsWith('/sections')) return 'listing this course’s sections'
  if (path.startsWith('/progress')) return 'checking the status of the grade upload'
  if (path === '/courses') return 'listing your courses'
  return `the request to ${path}`
}

/** The Canvas permission a 403 on this endpoint usually points at. */
function permissionHint(path: string): string {
  if (path.endsWith('/submissions') || path.includes('/update_grades')) {
    return (
      'This needs the "Grades - edit" permission in this course. TA roles often have it withheld, ' +
      'and it is granted per course role, so a token that works in one course can fail in another. ' +
      'Ask a Canvas admin to grant it, or export the Canvas CSV and upload it through the gradebook instead.'
    )
  }
  if (path.endsWith('/users')) {
    return 'This needs permission to view the course roster.'
  }
  return 'The token may lack permission for this course or endpoint.'
}

/** `<...>; rel="next"` — Canvas paginates via the Link header, not a body cursor. */
function nextLink(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim())
    if (match) return match[1]
  }
  return null
}

export class CanvasClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly fetchImpl: typeof fetch

  constructor(config: CanvasConfig, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '')
    this.token = config.token
    this.fetchImpl = fetchImpl
  }

  /** Returns null when Canvas is not configured, so callers can degrade to CSV. */
  static fromEnv(fetchImpl: typeof fetch = fetch): CanvasClient | null {
    const baseUrl = process.env.CANVAS_BASE_URL
    const token = process.env.CANVAS_TOKEN
    if (!baseUrl || !token) return null
    return new CanvasClient({ baseUrl, token }, fetchImpl)
  }

  static isConfigured(): boolean {
    return Boolean(process.env.CANVAS_BASE_URL && process.env.CANVAS_TOKEN)
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}/api/v1${path}`
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...init?.headers,
      },
    })

    if (!response.ok) {
      // Never echo the response body: Canvas errors can quote the request, and the
      // request carries the token.
      const endpoint = path.replace(/\?.*$/, '').replace(/^https?:\/\/[^/]+\/api\/v1/, '')
      const hint =
        response.status === 401
          ? 'Canvas rejected the token. Check CANVAS_TOKEN, and that it has not expired or been revoked.'
          : response.status === 403
            ? `Canvas refused ${describeEndpoint(endpoint)}. ${permissionHint(endpoint)}`
            : response.status === 404
              ? `Canvas has no such ${endpoint.includes('/assignments/') ? 'assignment' : 'course'} (${endpoint}).`
              : `Canvas returned ${response.status} for ${endpoint}.`
      throw new CanvasError(hint, response.status, endpoint)
    }

    return response
  }

  private async paginate<T>(path: string, max = 50): Promise<T[]> {
    const out: T[] = []
    let next: string | null = path

    for (let page = 0; next && page < max; page++) {
      const response: Response = await this.request(next)
      out.push(...((await response.json()) as T[]))
      next = nextLink(response.headers.get('link'))
    }

    return out
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(path, init)).json()) as T
  }

  /**
   * Courses the token holder helps run — teacher, TA, or designer.
   *
   * Canvas's `enrollment_type` filter takes a single role, so filtering server-side
   * would mean one request per role. Instead every active course is fetched once
   * and filtered on the enrolments Canvas already returns.
   */
  async listCourses(): Promise<CanvasCourse[]> {
    const courses = await this.paginate<CanvasCourse>(
      '/courses?enrollment_state=active&include[]=term&per_page=100',
    )
    return courses.filter((c) => staffRoleFor(c) !== null)
  }

  listSections(courseId: string): Promise<CanvasSection[]> {
    return this.paginate<CanvasSection>(`/courses/${courseId}/sections?per_page=100`)
  }

  listStudents(courseId: string): Promise<CanvasUser[]> {
    return this.paginate<CanvasUser>(
      `/courses/${courseId}/users?enrollment_type[]=student&enrollment_state[]=active&include[]=enrollments&include[]=email&per_page=100`,
    )
  }

  listAssignments(courseId: string): Promise<CanvasAssignment[]> {
    return this.paginate<CanvasAssignment>(`/courses/${courseId}/assignments?per_page=100`)
  }

  listSubmissions(courseId: string, assignmentId: string): Promise<CanvasSubmission[]> {
    return this.paginate<CanvasSubmission>(
      `/courses/${courseId}/assignments/${assignmentId}/submissions?per_page=100`,
    )
  }

  /**
   * Bulk grade update. Asynchronous: Canvas returns a Progress object that must be
   * polled, so a 200 here means "accepted", not "graded".
   *
   * Students are addressed by SIS identifier so the push never depends on Canvas's
   * internal user ids, which TWISTER does not store. The *prefix* must match the
   * kind of identifier: `sis_user_id:` for a GT ID, `sis_login_id:` for a GT
   * username. Sending a username under `sis_user_id:` is not an error — Canvas
   * simply matches no one, and the push silently grades nobody.
   */
  async updateGrades(
    courseId: string,
    assignmentId: string,
    grades: { key: string; kind: GradeKeyKind; score: number }[],
  ): Promise<CanvasProgress> {
    const body = new URLSearchParams()
    for (const { key, kind, score } of grades) {
      body.append(`grade_data[${kind}:${key}][posted_grade]`, String(score))
    }

    return this.json<CanvasProgress>(
      `/courses/${courseId}/assignments/${assignmentId}/submissions/update_grades`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    )
  }

  getProgress(progressId: number | string): Promise<CanvasProgress> {
    return this.json<CanvasProgress>(`/progress/${progressId}`)
  }

  /** Polls until Canvas reports the bulk update finished or failed. */
  async waitForProgress(
    progressId: number | string,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<CanvasProgress> {
    const timeoutMs = options.timeoutMs ?? 120_000
    const intervalMs = options.intervalMs ?? 1_500
    const deadline = Date.now() + timeoutMs

    for (;;) {
      const progress = await this.getProgress(progressId)
      if (progress.workflow_state === 'completed' || progress.workflow_state === 'failed') {
        return progress
      }
      if (Date.now() > deadline) {
        throw new CanvasError(
          `Canvas is still processing the grade upload after ${Math.round(timeoutMs / 1000)}s. It may still complete — check the Canvas gradebook before retrying.`,
          504,
          '/progress',
        )
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
}
