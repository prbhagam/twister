import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@/generated/prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function create() {
  const url = process.env.DATABASE_URL ?? 'file:./dev.db'
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
}

// Next dev hot-reloads modules on every edit; without the global cache that
// would leak a new SQLite connection per reload.
export const prisma = globalForPrisma.prisma ?? create()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
