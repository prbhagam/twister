import { prisma } from '@/lib/db'

export async function audit(input: {
  actorUserId?: string | null; action: string; entityType: string; entityId?: string | null
  courseId?: string | null; metadata?: Record<string, unknown>; correlationId?: string | null
}) {
  // Metadata is deliberately caller-supplied and must never include credentials,
  // session values, raw uploads, response bodies, or generation seeds.
  return prisma.auditEvent.create({ data: { ...input, metadata: JSON.stringify(input.metadata ?? {}) } })
}
