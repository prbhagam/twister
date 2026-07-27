import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authorizeRunApi } from '@/lib/authorization'

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params
  if (!await authorizeRunApi(runId, 'course:view')) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const run = await prisma.generationRun.findUnique({
    where: { id: runId },
    select: { status: true, completedCount: true, studentCount: true, error: true },
  })
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(run, { headers: { 'cache-control': 'no-store' } })
}
