import type { NextConfig } from 'next'

// React's development error tooling reconstructs stack traces with eval(). Keep
// that narrow exception out of production CSPs.
const scriptSources = process.env.NODE_ENV === 'development'
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'"

const contentSecurityPolicy = `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSources}`

const nextConfig: NextConfig = {
  // playwright and pdf-lib must stay outside the bundler — they load native
  // browser binaries and large font tables at runtime.
  serverExternalPackages: ['playwright', 'pdf-lib', '@prisma/adapter-better-sqlite3'],
  async headers() {
    return [
      { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'Content-Security-Policy', value: `${contentSecurityPolicy}; frame-ancestors 'none'` },
      ] },
      // The student review page shows the paper a student held in an iframe, so
      // this one route may be framed — by TWISTER's own pages and nothing else.
      // Later rules override earlier ones for the same header key.
      { source: '/api/runs/:runId/pdf/:studentExamId', headers: [
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Content-Security-Policy', value: `${contentSecurityPolicy}; frame-ancestors 'self'` },
      ] },
    ]
  },
}

export default nextConfig
