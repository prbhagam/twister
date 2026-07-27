import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/db'

export const ROLES = ['OWNER', 'INSTRUCTOR', 'QUESTION_EDITOR', 'GRADER', 'AUDITOR'] as const
export type Role = (typeof ROLES)[number]
export type Permission =
  | 'course:manage' | 'course:view' | 'question:edit' | 'exam:generate'
  | 'grade:write' | 'grade:view' | 'export:grades' | 'audit:view' | 'delete:permanent'

const permissions: Record<Role, Permission[]> = {
  OWNER: ['course:manage','course:view','question:edit','exam:generate','grade:write','grade:view','export:grades','audit:view','delete:permanent'],
  INSTRUCTOR: ['course:manage','course:view','question:edit','exam:generate','grade:write','grade:view','export:grades','audit:view'],
  QUESTION_EDITOR: ['course:view','question:edit'],
  GRADER: ['course:view','grade:write','grade:view'],
  AUDITOR: ['course:view','grade:view','audit:view'],
}

export class AuthorizationError extends Error {}
export function isRole(value: string): value is Role { return (ROLES as readonly string[]).includes(value) }

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user || !isRole(user.role)) redirect('/login')
  return user as typeof user & { role: Role }
}

export function can(role: Role, permission: Permission) { return permissions[role].includes(permission) }

export async function requireCoursePermission(courseId: string, permission: Permission) {
  const user = await requireUser()
  if (user.role === 'OWNER') return user
  const membership = await prisma.courseMembership.findUnique({ where: { userId_courseId: { userId: user.id, courseId } } })
  const effectiveRole = membership?.active && isRole(membership.role) ? membership.role : null
  if (!effectiveRole || !can(effectiveRole, permission)) throw new AuthorizationError('You do not have access to this course.')
  return user
}

export async function requireExamPermission(examId: string, permission: Permission) {
  const exam = await prisma.exam.findUnique({ where: { id: examId }, select: { courseId: true, archivedAt: true } })
  if (!exam || exam.archivedAt) throw new AuthorizationError('Exam not found.')
  return requireCoursePermission(exam.courseId, permission)
}

export async function requireRunPermission(runId: string, permission: Permission) {
  const run = await prisma.generationRun.findUnique({ where: { id: runId }, include: { exam: { select: { courseId: true } } } })
  if (!run) throw new AuthorizationError('Generation run not found.')
  const user = await requireCoursePermission(run.exam.courseId, permission)
  return { user, run }
}

/** API-route variant: return null rather than redirecting or leaking object existence. */
export async function authorizeRunApi(runId: string, permission: Permission) {
  try { return await requireRunPermission(runId, permission) } catch { return null }
}
