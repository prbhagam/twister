import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // playwright and pdf-lib must stay outside the bundler — they load native
  // browser binaries and large font tables at runtime.
  serverExternalPackages: ['playwright', 'pdf-lib', '@prisma/adapter-better-sqlite3'],
}

export default nextConfig
