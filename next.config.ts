import type { NextConfig } from 'next'

// React's development error tooling reconstructs stack traces with eval(). Keep
// that narrow exception out of production CSPs.
const scriptSources = process.env.NODE_ENV === 'development'
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'"

const nextConfig: NextConfig = {
  // playwright and pdf-lib must stay outside the bundler — they load native
  // browser binaries and large font tables at runtime.
  serverExternalPackages: ['playwright', 'pdf-lib', '@prisma/adapter-better-sqlite3'],
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'Content-Security-Policy', value: `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src ${scriptSources}` },
    ] }]
  },
}

export default nextConfig
