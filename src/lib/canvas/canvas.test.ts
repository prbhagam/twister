import { describe, expect, it, vi } from 'vitest'
import { CanvasClient, CanvasError, type CanvasSubmission, type CanvasUser } from './client'
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

  it('keys bulk grades on sis_user_id, not Canvas ids', async () => {
    let body = ''
    const fetchImpl = stubFetch((_url, init) => {
      body = String(init?.body)
      return jsonResponse({ id: 77, workflow_state: 'queued', completion: 0 })
    })

    await new CanvasClient(CONFIG, fetchImpl).updateGrades('1', '2', [
      { gtId: '903000001', score: 11 },
      { gtId: '903000002', score: 9.5 },
    ])

    expect(decodeURIComponent(body)).toContain('grade_data[sis_user_id:903000001][posted_grade]=11')
    expect(decodeURIComponent(body)).toContain('grade_data[sis_user_id:903000002][posted_grade]=9.5')
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

  it('REJECTS a student with no SIS id rather than seeding on the Canvas id', () => {
    // This is the whole point of the check: substituting Canvas's internal id would
    // give this student a different paper than the CSV path produces, and a
    // regenerated exam would not match the sheet they already filled in.
    const result = fromCanvasRoster([user({ id: 1, sis_user_id: null })], SECTIONS)
    expect(result.students).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/did not return an SIS ID/i)
  })

  it('rejects an SIS id that is not a 9-digit GT ID', () => {
    const result = fromCanvasRoster([user({ id: 1, sis_user_id: 'abc' })], SECTIONS)
    expect(result.students).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/not a 9-digit GT ID/)
  })

  it('explains the likely cause when no student has a usable id', () => {
    const result = fromCanvasRoster(
      [user({ id: 1, sis_user_id: null }), user({ id: 2, sis_user_id: null })],
      SECTIONS,
    )
    expect(result.errors[0]).toMatch(/lacks permission to read SIS IDs/i)
    expect(result.errors[0]).toMatch(/cannot be reproduced/i)
  })

  it('keeps good students even when others are rejected', () => {
    const result = fromCanvasRoster(
      [user({ id: 1 }), user({ id: 2, name: 'No Id', sis_user_id: null })],
      SECTIONS,
    )
    expect(result.students).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
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
    expect(gradesToPush(plan)).toEqual([{ gtId: 'nabbott3', score: 9 }])
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
      { gtId: '903000001', score: 10 },
      { gtId: '903000003', score: 12 },
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
