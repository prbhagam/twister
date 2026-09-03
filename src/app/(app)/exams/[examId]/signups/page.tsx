import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { can, requireExamPermission } from '@/lib/authorization'
import { byLastName } from '@/lib/roster'
import { Badge, Card, CardHeader, Empty, Notice } from '@/components/ui'
import { ExceptionsCard } from './ExceptionsCard'
import { SessionsCard } from './SessionsCard'
import { SignupSheetPanel } from './SignupSheetPanel'

export const dynamic = 'force-dynamic'

export default async function SignupsPage({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = await params
  const user = await requireExamPermission(examId, 'course:view')
  const canManage = can(user.role, 'course:manage')

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      course: true,
      signupImports: { orderBy: { importedAt: 'desc' }, take: 1 },
      signupBuckets: {
        include: { rows: { include: { student: true } } },
        orderBy: [{ kind: 'asc' }, { sessionAt: 'asc' }],
      },
    },
  })
  if (!exam) notFound()

  const lastImport = exam.signupImports[0] ?? null
  const detail = lastImport
    ? (JSON.parse(lastImport.detail) as { unmatched: { gtId: string; canvasUserId: string; name: string; signupSlot: string }[]; warnings: string[] })
    : null

  const sessions = exam.signupBuckets.filter((b) => b.kind === 'session')
  const exceptions = exam.signupBuckets.filter((b) => b.kind === 'exception')
  const notSignedUp = exam.signupBuckets.find((b) => b.kind === 'not_signed_up') ?? null
  const notSignedUpStudents = (notSignedUp?.rows ?? []).map((r) => r.student).sort(byLastName)

  const totalRoster = exam.signupBuckets.reduce((n, b) => n + b.rows.length, 0)

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/exams/${exam.id}`} className="text-xs text-slate-500 hover:underline">
          ← {exam.title}
        </Link>
        <h1 className="mt-1 text-lg font-semibold">Sign-ups</h1>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge>{totalRoster} on roster</Badge>
          <Badge tone="blue">
            {sessions.reduce((n, b) => n + b.rows.length, 0)} in a session
          </Badge>
          <Badge tone="amber">{exceptions.reduce((n, b) => n + b.rows.length, 0)} exempt</Badge>
          <Badge tone="neutral">{notSignedUp?.rows.length ?? 0} not signed up</Badge>
          <span className="ml-auto text-xs text-slate-500">
            {lastImport ? `Last synced ${lastImport.importedAt.toLocaleString()}` : 'Never synced'}
          </span>
        </div>
        {lastImport?.error ? (
          <Notice tone="red" title="Last sync failed" >
            <p className="mt-1">{lastImport.error}</p>
          </Notice>
        ) : null}
        {detail?.warnings.length ? (
          <Notice tone="amber" title="Synced with warnings">
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {detail.warnings.slice(0, 8).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {detail?.unmatched.length ? (
          <Notice tone="amber" title={`${detail.unmatched.length} sheet row(s) did not match a roster student`}>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {detail.unmatched.slice(0, 8).map((u, i) => (
                <li key={i}>
                  {u.name || '(no name)'} — GTID {u.gtId || '—'}, Canvas ID {u.canvasUserId || '—'}
                </li>
              ))}
              {detail.unmatched.length > 8 ? <li>…and {detail.unmatched.length - 8} more.</li> : null}
            </ul>
          </Notice>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Sheet" subtitle="A Google Sheet shared as “Anyone with the link can view”" />
        <SignupSheetPanel examId={examId} initialUrl={exam.signupSheetUrl ?? ''} canManage={canManage} />
      </Card>

      <Card>
        <CardHeader title="Sessions" subtitle={`${sessions.length} session${sessions.length === 1 ? '' : 's'}`} />
        {sessions.length === 0 ? (
          <Empty>No sessions yet — sync the sheet to populate this.</Empty>
        ) : (
          <SessionsCard examId={examId} buckets={sessions} canManage={canManage} />
        )}
      </Card>

      <Card>
        <CardHeader title="Exceptions" subtitle={`${exceptions.length} distinct exception${exceptions.length === 1 ? '' : 's'}`} />
        {exceptions.length === 0 ? (
          <Empty>No exceptions on this sheet.</Empty>
        ) : (
          <ExceptionsCard examId={examId} buckets={exceptions} canManage={canManage} />
        )}
      </Card>

      <Card>
        <CardHeader title="Not signed up" subtitle={`${notSignedUpStudents.length} student${notSignedUpStudents.length === 1 ? '' : 's'}`} />
        {notSignedUpStudents.length === 0 ? (
          <Empty>Everyone on the roster is accounted for.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 px-5 py-2 text-sm">
            {notSignedUpStudents.map((s) => (
              <li key={s.id} className="py-1.5">
                {s.lastName}, {s.firstName}
                <span className="ml-2 font-mono text-xs text-slate-400">{s.gtId ?? s.username ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
