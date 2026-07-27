import { describe, expect, it, vi } from 'vitest'
import {
  CanvasClient,
  CanvasError,
  staffRoleFor,
  type CanvasSubmission,
  type CanvasUser,
} from './client'
import { gradePushWarnings, gradesToPush, planGradePush } from './grades'
import { diffRoster, fromCanvasRoster } from './roster'
import type { ScoreRow } from '../export'

// --- fetch stub ---------------------------------------------------------------

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  ) as unknown as typeof fetch
}

const CONFIG = { baseUrl: 'https://gatech.instructure.com', token: 'secret-token' }

// --- client -------------------------------------------------------------------

describe('CanvasClient', () => {
  it('sends the token as a bearer header', async () => {
    const fetchImpl = stubFetch(() => jsonResponse([]))
    await new CanvasClient(CONFIG, fetchImpl).listSections('123')

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token')
  })

  it('follows the Link header across pages', async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.includes('page=2')) return jsonResponse([{ id: 3 }, { id: 4 }])
      return jsonResponse([{ id: 1 }, { id: 2 }], {
        link: '<https://gatech.instructure.com/api/v1/courses/1/sections?page=2>; rel="next", <...>; rel="last"',
      })
    })

    const sections = await new CanvasClient(CONFIG, fetchImpl).listSections('1')
    expect(sections.map((s) => s.id)).toEqual([1, 2, 3, 4])
  })

  it('stops paginating when there is no next link', async () => {
    const fetchImpl = stubFetch(() => jsonResponse([{ id: 1 }]))
    await new CanvasClient(CONFIG, fetchImpl).listSections('1')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('explains a 401 without echoing the response body', async () => {
    // Canvas error bodies can quote the request, which carries the token.
    const fetchImpl = stubFetch(
      () => new Response(JSON.stringify({ errors: [{ message: 'Bearer secret-token' }] }), { status: 401 }),
    )

    await expect(new CanvasClient(CONFIG, fetchImpl).listSections('1')).rejects.toThrow(CanvasError)
    await expect(new CanvasClient(CONFIG, fetchImpl).listSections('1')).rejects.toThrow(
      /rejected the token/i,
    )
    await expect(new CanvasClient(CONFIG, fetchImpl).listSections('1')).rejects.not.toThrow(
      /secret-token/,
    )
  })

  it('distinguishes a permissions failure from a missing course', async () => {
    const forbidden = stubFetch(() => new Response('{}', { status: 403 }))
    await expect(new CanvasClient(CONFIG, forbidden).listSections('1')).rejects.toThrow(/permission/i)

    const missing = stubFetch(() => new Response('{}', { status: 404 }))
    await expect(new CanvasClient(CONFIG, missing).listSections('1')).rejects.toThrow(/no such course/i)
  })

  it('names which operation a 403 refused, not just "this request"', async () => {
    // A score push touches four endpoints at once; "permission denied" is useless
    // without knowing which one.
    const forbidden = stubFetch(() => new Response('{}', { status: 403 }))
    const client = new CanvasClient(CONFIG, forbidden)

    await expect(client.listSubmissions('1', '2')).rejects.toThrow(/reading existing grades/i)
    await expect(client.listAssignments('1')).rejects.toThrow(/listing this course/i)
    await expect(client.listStudents('1')).rejects.toThrow(/listing this course’s students/i)
    await expect(
      client.updateGrades('1', '2', [{ key: '903000001', kind: 'sis_user_id', score: 1 }]),
    ).rejects.toThrow(
      /writing grades/i,
    )
  })

  it('points a grades 403 at the specific Canvas permission and the CSV fallback', async () => {
    const forbidden = stubFetch(() => new Response('{}', { status: 403 }))
    const message = await new CanvasClient(CONFIG, forbidden)
      .listSubmissions('1', '2')
      .catch((e: Error) => e.message)

    expect(message).toMatch(/Grades - edit/)
    expect(message).toMatch(/TA roles often have it withheld/)
    expect(message).toMatch(/gradebook/i)
  })

  it('records the failing endpoint on the error', async () => {
    const forbidden = stubFetch(() => new Response('{}', { status: 403 }))
    const error = await new CanvasClient(CONFIG, forbidden)
      .listSubmissions('1', '2')
      .catch((e: CanvasError) => e)

    expect(error).toBeInstanceOf(CanvasError)
    expect((error as CanvasError).path).toBe('/courses/1/assignments/2/submissions')
    expect((error as CanvasError).status).toBe(403)
  })

  it('keys bulk grades on SIS identifiers, not Canvas ids', async () => {
    let body = ''
    const fetchImpl = stubFetch((_url, init) => {
      body = String(init?.body)
      return jsonResponse({ id: 77, workflow_state: 'queued', completion: 0 })
    })

    await new CanvasClient(CONFIG, fetchImpl).updateGrades('1', '2', [
      { key: '903000001', kind: 'sis_user_id', score: 11 },
      { key: '903000002', kind: 'sis_user_id', score: 9.5 },
    ])

    expect(decodeURIComponent(body)).toContain('grade_data[sis_user_id:903000001][posted_grade]=11')
    expect(decodeURIComponent(body)).toContain('grade_data[sis_user_id:903000002][posted_grade]=9.5')
  })

  it('addresses a username under sis_login_id, not sis_user_id', async () => {
    // Canvas does not error on grade_data[sis_user_id:mbello3] — it matches no one
    // and the push silently grades nobody, which is the worst possible failure for
    // a write to student records.
    let body = ''
    const fetchImpl = stubFetch((_url, init) => {
      body = String(init?.body)
      return jsonResponse({ id: 77, workflow_state: 'queued', completion: 0 })
    })

    await new CanvasClient(CONFIG, fetchImpl).updateGrades('1', '2', [
      { key: 'mbello3', kind: 'sis_login_id', score: 8 },
    ])

    expect(decodeURIComponent(body)).toContain('grade_data[sis_login_id:mbello3][posted_grade]=8')
    expect(decodeURIComponent(body)).not.toContain('sis_user_id')
  })

  it('polls a Progress object until it completes', async () => {
    let calls = 0
    const fetchImpl = stubFetch(() => {
      calls++
      return jsonResponse({
        id: 77,
        workflow_state: calls < 3 ? 'running' : 'completed',
        completion: calls < 3 ? 50 : 100,
      })
    })

    const progress = await new CanvasClient(CONFIG, fetchImpl).waitForProgress(77, { intervalMs: 1 })
    expect(progress.workflow_state).toBe('completed')
    expect(calls).toBe(3)
  })

  it('gives up rather than polling forever', async () => {
    const fetchImpl = stubFetch(() => jsonResponse({ id: 77, workflow_state: 'running', completion: 10 }))
    await expect(
      new CanvasClient(CONFIG, fetchImpl).waitForProgress(77, { intervalMs: 1, timeoutMs: 20 }),
    ).rejects.toThrow(/still processing/i)
  })

  it('includes courses you TA, not only ones you teach', async () => {
    // enrollment_type=teacher silently hides every course a head TA supports, which
    // is most of them.
    const fetchImpl = stubFetch(() =>
      jsonResponse([
        { id: 1, name: 'Taught', enrollments: [{ type: 'teacher' }] },
        { id: 2, name: 'TAed', enrollments: [{ type: 'ta' }] },
        { id: 3, name: 'Designed', enrollments: [{ type: 'designer' }] },
        { id: 4, name: 'Enrolled as a student', enrollments: [{ type: 'student' }] },
        { id: 5, name: 'Observing', enrollments: [{ type: 'observer' }] },
      ]),
    )

    const courses = await new CanvasClient(CONFIG, fetchImpl).listCourses()
    expect(courses.map((c) => c.id)).toEqual([1, 2, 3])
  })

  it('does not filter by enrollment_type server-side', async () => {
    // Canvas takes a single role there, so filtering server-side would need one
    // request per role.
    const fetchImpl = stubFetch(() => jsonResponse([]))
    await new CanvasClient(CONFIG, fetchImpl).listCourses()
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).not.toContain('enrollment_type')
  })

  it('is not configured when the environment is missing', () => {
    const saved = { url: process.env.CANVAS_BASE_URL, token: process.env.CANVAS_TOKEN }
    delete process.env.CANVAS_BASE_URL
    delete process.env.CANVAS_TOKEN
    expect(CanvasClient.fromEnv()).toBeNull()
    expect(CanvasClient.isConfigured()).toBe(false)
    if (saved.url) process.env.CANVAS_BASE_URL = saved.url
    if (saved.token) process.env.CANVAS_TOKEN = saved.token
  })
})

describe('staffRoleFor', () => {
  it('reports the staff role', () => {
    expect(staffRoleFor({ id: 1, name: 'x', enrollments: [{ type: 'ta' }] })).toBe('ta')
    expect(staffRoleFor({ id: 1, name: 'x', enrollments: [{ type: 'teacher' }] })).toBe('teacher')
  })

  it('prefers the most privileged role when someone holds several', () => {
    expect(
      staffRoleFor({ id: 1, name: 'x', enrollments: [{ type: 'ta' }, { type: 'teacher' }] }),
    ).toBe('teacher')
  })

  it('returns null for a course you only take or observe', () => {
    expect(staffRoleFor({ id: 1, name: 'x', enrollments: [{ type: 'student' }] })).toBeNull()
    expect(staffRoleFor({ id: 1, name: 'x', enrollments: [] })).toBeNull()
    expect(staffRoleFor({ id: 1, name: 'x' })).toBeNull()
  })
})

// --- roster -------------------------------------------------------------------

const SECTIONS = [
  { id: 10, name: 'CS 1301 O1' },
  { id: 20, name: 'CS 1301 QH' },
]

function user(overrides: Partial<CanvasUser> & { id: number }): CanvasUser {
  return {
    name: 'Nadia Abbott',
    sortable_name: 'Abbott, Nadia',
    sis_user_id: '903000001',
    login_id: 'nabbott3',
    email: 'nabbott3@gatech.edu',
    enrollments: [{ course_section_id: 10, type: 'StudentEnrollment', enrollment_state: 'active' }],
    ...overrides,
  }
}

describe('fromCanvasRoster', () => {
  it('maps a Canvas roster into the same shape as the CSV importer', () => {
    const result = fromCanvasRoster([user({ id: 1 })], SECTIONS)
    expect(result.students).toEqual([
      {
        gtId: '903000001',
        username: 'nabbott3',
        firstName: 'Nadia',
        lastName: 'Abbott',
        email: 'nabbott3@gatech.edu',
        sections: ['CS 1301 O1'],
        role: 'Student',
      },
    ])
    expect(result.rejected).toEqual([])
  })

  it('still imports a student when Canvas withholds SIS IDs but returns login IDs', () => {
    // The real-world case: the token cannot read SIS data. Blocking the import here
    // would ask an exam-level question at roster time; the exam decides later which
    // identifier it seeds from, and refuses to generate if it is missing.
    const result = fromCanvasRoster([user({ id: 1, sis_user_id: null })], SECTIONS)
    expect(result.students).toHaveLength(1)
    expect(result.students[0]).toMatchObject({ gtId: null, username: 'nabbott3' })
    expect(result.rejected).toHaveLength(0)
  })

  it('says plainly that a roster with no GT IDs requires a username-seeded exam', () => {
    const result = fromCanvasRoster(
      [user({ id: 1, sis_user_id: null }), user({ id: 2, sis_user_id: null, login_id: 'mbello3' })],
      SECTIONS,
    )
    expect(result.withGtId).toBe(0)
    expect(result.withUsername).toBe(2)
    expect(result.errors[0]).toMatch(/no GT IDs/i)
    expect(result.errors[0]).toMatch(/seed on "GT username"/i)
  })

  it('does not store a malformed SIS id as a GT ID', () => {
    const result = fromCanvasRoster([user({ id: 1, sis_user_id: 'abc' })], SECTIONS)
    expect(result.students[0].gtId).toBeNull()
    expect(result.students[0].username).toBe('nabbott3')
  })

  it('rejects only a student with neither identifier', () => {
    const result = fromCanvasRoster(
      [user({ id: 1 }), user({ id: 2, name: 'No Id', sis_user_id: null, login_id: null })],
      SECTIONS,
    )
    expect(result.students).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toMatch(/neither an SIS ID .* nor a login ID/i)
  })

  it('flags a partially-identified roster, which is the worst case', () => {
    const result = fromCanvasRoster(
      [user({ id: 1 }), user({ id: 2, sis_user_id: null, login_id: 'mbello3' })],
      SECTIONS,
    )
    expect(result.withGtId).toBe(1)
    expect(result.errors[0]).toMatch(/1 student\(s\) have no GT ID/)
  })

  it('resolves section names and counts them', () => {
    const result = fromCanvasRoster(
      [
        user({ id: 1 }),
        user({
          id: 2,
          sis_user_id: '903000002',
          enrollments: [{ course_section_id: 20, type: 'StudentEnrollment', enrollment_state: 'active' }],
        }),
      ],
      SECTIONS,
    )
    expect(result.sections).toEqual([
      { code: 'CS 1301 O1', label: 'CS 1301 O1', count: 1 },
      { code: 'CS 1301 QH', label: 'CS 1301 QH', count: 1 },
    ])
  })

  it('ignores non-student enrollments on the same user', () => {
    const result = fromCanvasRoster(
      [
        user({
          id: 1,
          enrollments: [
            { course_section_id: 10, type: 'StudentEnrollment', enrollment_state: 'active' },
            { course_section_id: 20, type: 'TaEnrollment', enrollment_state: 'active' },
          ],
        }),
      ],
      SECTIONS,
    )
    expect(result.students[0].sections).toEqual(['CS 1301 O1'])
  })

  it('deduplicates a repeated GT ID', () => {
    const result = fromCanvasRoster([user({ id: 1 }), user({ id: 2 })], SECTIONS)
    expect(result.students).toHaveLength(1)
    expect(result.errors[0]).toMatch(/more than once/)
  })

  it('falls back to login_id for the email but never invents one', () => {
    const withLogin = fromCanvasRoster([user({ id: 1, email: null })], SECTIONS)
    expect(withLogin.students[0].email).toBe('nabbott3@gatech.edu')

    const withNeither = fromCanvasRoster([user({ id: 1, email: null, login_id: null })], SECTIONS)
    expect(withNeither.students[0].email).toBe('')
  })

  it('splits the name from sortable_name when available', () => {
    const result = fromCanvasRoster(
      [user({ id: 1, name: 'Ann Marie Fitzgerald', sortable_name: 'Fitzgerald, Ann Marie' })],
      SECTIONS,
    )
    expect(result.students[0]).toMatchObject({ firstName: 'Ann Marie', lastName: 'Fitzgerald' })
  })
})

describe('diffRoster', () => {
  const existing = [
    { gtId: '903000001', username: 'nabbott3', firstName: 'Nadia', lastName: 'Abbott', email: 'a@x.edu', sections: ['O1'] },
    { gtId: '903000002', username: 'mbello3', firstName: 'Marc', lastName: 'Bello', email: 'b@x.edu', sections: ['O1'] },
  ]

  it('detects a late add', () => {
    const incoming = [
      ...existing.map((s) => ({ ...s, role: 'Student' })),
      { gtId: '903000003', username: 'wchen3', firstName: 'Wei', lastName: 'Marchetti', email: 'c@x.edu', sections: ['QH'], role: 'Student' },
    ]
    const diff = diffRoster(existing, incoming)
    expect(diff.added.map((s) => s.gtId)).toEqual(['903000003'])
    expect(diff.removed).toEqual([])
  })

  it('detects a drop', () => {
    const diff = diffRoster(existing, [{ ...existing[0], role: 'Student' }])
    expect(diff.removed).toEqual([{ gtId: '903000002', firstName: 'Marc', lastName: 'Bello' }])
  })

  it('reports a section change field by field', () => {
    const diff = diffRoster(existing, [
      { ...existing[0], sections: ['QH'], role: 'Student' },
      { ...existing[1], role: 'Student' },
    ])
    expect(diff.changed).toEqual([{ gtId: '903000001', field: 'sections', from: 'O1', to: 'QH' }])
    expect(diff.unchanged).toBe(1)
  })

  it('reports nothing when the roster is identical', () => {
    const diff = diffRoster(existing, existing.map((s) => ({ ...s, role: 'Student' })))
    expect(diff).toMatchObject({ added: [], removed: [], changed: [], unchanged: 2 })
  })

  it('matches a username-only Canvas pull against a GT-ID roster', () => {
    // Otherwise a course imported by CSV and then synced from a token without SIS
    // access would report the entire class as both added and dropped.
    const canvasOnlyUsernames = existing.map((s) => ({
      ...s,
      gtId: null,
      role: 'Student',
    }))
    const diff = diffRoster(existing, canvasOnlyUsernames)
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.unchanged).toBe(2)
  })

  it('falls back to email when neither id is shared', () => {
    const byEmailOnly = [
      { gtId: null, username: null, firstName: 'Nadia', lastName: 'Abbott', email: 'a@x.edu', sections: ['O1'], role: 'Student' },
    ]
    const diff = diffRoster([existing[0]], byEmailOnly)
    expect(diff.added).toEqual([])
    expect(diff.unchanged).toBe(1)
  })
})

// --- grade push ---------------------------------------------------------------

function scoreRow(overrides: Partial<ScoreRow> & { gtId: string }): ScoreRow {
  const { gtId, ...rest } = overrides
  return {
    student: {
      firstName: 'Test',
      lastName: `Student${gtId.slice(-1)}`,
      gtId,
      username: `user${gtId.slice(-1)}`,
      email: `${gtId}@gatech.edu`,
      sections: [],
      traceCode: 'ABC123',
    },
    status: 'graded',
    earned: 10,
    possible: 13,
    questions: [],
    ...rest,
  }
}

const submission = (user_id: number, score: number | null): CanvasSubmission => ({
  user_id,
  score,
  grade: score === null ? null : String(score),
  workflow_state: score === null ? 'unsubmitted' : 'graded',
})

describe('planGradePush', () => {
  const ids = new Map([
    ['903000001', 1],
    ['903000002', 2],
    ['903000003', 3],
  ])

  it('treats an ungraded Canvas submission as a new score', () => {
    const plan = planGradePush([scoreRow({ gtId: '903000001' })], [submission(1, null)], ids)
    expect(plan.changes).toHaveLength(1)
    expect(plan.conflicts).toHaveLength(0)
    expect(plan.totalToPush).toBe(1)
  })

  it('treats a matching score as a no-op', () => {
    const plan = planGradePush([scoreRow({ gtId: '903000001', earned: 10 })], [submission(1, 10)], ids)
    expect(plan.unchanged).toHaveLength(1)
    expect(plan.totalToPush).toBe(0)
  })

  it('flags a differing existing score as a conflict rather than overwriting quietly', () => {
    const plan = planGradePush([scoreRow({ gtId: '903000001', earned: 10 })], [submission(1, 7)], ids)
    expect(plan.conflicts).toEqual([expect.objectContaining({ score: 10, existing: 7 })])
    expect(plan.changes).toHaveLength(0)
  })

  it('skips absentees rather than pushing a zero', () => {
    // "Absent" and "scored zero" are different claims; only the instructor makes
    // the second one.
    const plan = planGradePush(
      [scoreRow({ gtId: '903000001', status: 'not_taken', earned: 0 })],
      [submission(1, null)],
      ids,
    )
    expect(plan.skippedNotTaken).toHaveLength(1)
    expect(plan.totalToPush).toBe(0)
  })

  it('skips a student with neither a GT ID nor a username', () => {
    const row = scoreRow({ gtId: 'unknown' })
    row.student.username = null
    const plan = planGradePush([row], [], new Map())
    expect(plan.skippedNoGtId).toHaveLength(1)
    expect(plan.totalToPush).toBe(0)
  })

  it('falls back to the username when there is no GT ID', () => {
    // A Canvas token without SIS permission can still identify students by login
    // id, so an exam seeded on usernames must still be pushable.
    const row = scoreRow({ gtId: 'unknown', earned: 9 })
    row.student.gtId = null
    row.student.username = 'nabbott3'

    const plan = planGradePush([row], [submission(42, null)], new Map([['nabbott3', 42]]))
    expect(plan.skippedNoGtId).toHaveLength(0)
    // Addressed as a login id, because it is one.
    expect(gradesToPush(plan)).toEqual([{ key: 'nabbott3', kind: 'sis_login_id', score: 9 }])
  })

  it('tags GT-ID students as sis_user_id and username students as sis_login_id', () => {
    const withGtId = scoreRow({ gtId: '903000001', earned: 5 })
    const withUsername = scoreRow({ gtId: '903000002', earned: 6 })
    withUsername.student.gtId = null
    withUsername.student.username = 'mbello3'

    const plan = planGradePush([withGtId, withUsername], [], new Map())
    const kinds = Object.fromEntries(gradesToPush(plan).map((g) => [g.key, g.kind]))
    expect(kinds['903000001']).toBe('sis_user_id')
    expect(kinds['mbello3']).toBe('sis_login_id')
  })

  it('orders the plan by last name so it can be read against a roster', () => {
    const plan = planGradePush(
      [
        scoreRow({ gtId: '903000003' }),
        scoreRow({ gtId: '903000001' }),
        scoreRow({ gtId: '903000002' }),
      ],
      [],
      ids,
    )
    expect(plan.changes.map((c) => c.name)).toEqual(['Student1, Test', 'Student2, Test', 'Student3, Test'])
  })

  it('pushes new scores and accepted overwrites, and nothing else', () => {
    const plan = planGradePush(
      [
        scoreRow({ gtId: '903000001', earned: 10 }), // new
        scoreRow({ gtId: '903000002', earned: 10 }), // unchanged
        scoreRow({ gtId: '903000003', earned: 12 }), // conflict
      ],
      [submission(1, null), submission(2, 10), submission(3, 5)],
      ids,
    )
    expect(gradesToPush(plan)).toEqual([
      { key: '903000001', kind: 'sis_user_id', score: 10 },
      { key: '903000003', kind: 'sis_user_id', score: 12 },
    ])
  })
})

describe('gradePushWarnings', () => {
  const plan = planGradePush(
    [scoreRow({ gtId: '903000001', earned: 10, possible: 13 })],
    [submission(1, null)],
    new Map([['903000001', 1]]),
  )

  it('warns when the Canvas assignment is out of a different number of points', () => {
    const warnings = gradePushWarnings(plan, { points_possible: 100, published: true })
    expect(warnings.some((w) => /out of 13 points but the Canvas assignment is out of 100/.test(w))).toBe(true)
  })

  it('warns about an unpublished assignment', () => {
    expect(gradePushWarnings(plan, { points_possible: 13, published: false })[0]).toMatch(/unpublished/i)
  })

  it('warns about a manual posting policy', () => {
    const warnings = gradePushWarnings(plan, { points_possible: 13, published: true, post_manually: true })
    expect(warnings.some((w) => /manual posting policy/i.test(w))).toBe(true)
  })

  it('is quiet when everything lines up', () => {
    expect(gradePushWarnings(plan, { points_possible: 13, published: true })).toEqual([])
  })
})
