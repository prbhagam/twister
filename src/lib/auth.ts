import { createHmac, timingSafeEqual, randomBytes, scryptSync } from 'node:crypto'
import { cookies } from 'next/headers'

const COOKIE = 'twister_session'
const MAX_AGE_SECONDS = 60 * 60 * 12

function secret() {
  const s = process.env.TWISTER_SESSION_SECRET
  if (!s) throw new Error('TWISTER_SESSION_SECRET is not set (see .env.example)')
  return s
}

// --- password hashing (scrypt; no native build step) -------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(password, salt, 64)
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split(':')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const key = scryptSync(password, Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(keyHex, 'hex')
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// --- signed session cookie ---------------------------------------------------

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function createSessionToken(email: string): string {
  const payload = `${Buffer.from(email).toString('base64url')}.${Date.now() + MAX_AGE_SECONDS * 1000}`
  return `${payload}.${sign(payload)}`
}

/** Returns the session email, or null if the token is absent, tampered, or expired. */
export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [emailB64, expiresRaw, mac] = parts
  const payload = `${emailB64}.${expiresRaw}`

  const expected = Buffer.from(sign(payload))
  const actual = Buffer.from(mac)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  const expires = Number(expiresRaw)
  if (!Number.isFinite(expires) || Date.now() > expires) return null

  return Buffer.from(emailB64, 'base64url').toString('utf8')
}

export async function setSession(email: string) {
  const jar = await cookies()
  jar.set(COOKIE, createSessionToken(email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function clearSession() {
  const jar = await cookies()
  jar.delete(COOKIE)
}

export async function getSession(): Promise<string | null> {
  const jar = await cookies()
  return readSessionToken(jar.get(COOKIE)?.value)
}

export const SESSION_COOKIE = COOKIE
