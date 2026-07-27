import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/db'

const COOKIE = 'twister_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12

export interface TrustedIdentity {
  email: string
  subject?: string
  displayName?: string
}

/** Boundary for a future CAS adapter. The adapter must supply a *verified* identity;
 * this app maps its normalized email/subject to a local user and local role. */
export interface AuthenticationAdapter {
  authenticate(credentials: unknown): Promise<TrustedIdentity | null>
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split(':')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(keyHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function setSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
  await prisma.session.create({ data: { userId, tokenHash: tokenHash(token), expiresAt } })
  const jar = await cookies()
  jar.set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
    path: '/', maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export async function clearSession() {
  const jar = await cookies()
  const token = jar.get(COOKIE)?.value
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } })
  jar.delete(COOKIE)
}

export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE)?.value
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) }, include: { user: true },
  })
  if (!session || session.expiresAt <= new Date() || !session.user.active) {
    if (session) await prisma.session.delete({ where: { id: session.id } })
    return null
  }
  return session.user
}

/** Compatibility helper for layouts that only display the signed-in email. */
export async function getSession() { return (await getCurrentUser())?.email ?? null }
export const SESSION_COOKIE = COOKIE

/** Proxy cannot query SQLite safely; it only performs an inexpensive preliminary gate.
 * Every sensitive operation must call `requireUser`/authorization helpers server-side. */
export function hasSessionCookie(token: string | undefined) { return Boolean(token && token.length >= 32) }
