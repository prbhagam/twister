import { NextResponse, type NextRequest } from 'next/server'
import { hasSessionCookie, SESSION_COOKIE } from '@/lib/auth'

const PUBLIC = ['/login', '/api/auth/login']

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }

  if (hasSessionCookie(req.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', pathname)
  return NextResponse.redirect(url)
}

// Proxy always runs on the Node.js runtime, which is what lets the session HMAC
// use node:crypto directly.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
