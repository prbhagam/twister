import { redirect } from 'next/navigation'
import { getSession, hashPassword, setSession, verifyPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { audit } from '@/lib/audit'
import { Button, Card, Input, Label, Notice } from '@/components/ui'

/**
 * Local development authentication. The bootstrap secret is consumed only to create
 * the first owner; all later users must be provisioned by an owner.
 */
async function login(formData: FormData) {
  'use server'

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/')

  const count = await prisma.user.count()
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user && count === 0) {
    const bootstrapEmail = (process.env.TWISTER_BOOTSTRAP_OWNER_EMAIL ?? '').trim().toLowerCase()
    const bootstrapPassword = process.env.TWISTER_BOOTSTRAP_OWNER_PASSWORD ?? ''
    if (!bootstrapEmail || !bootstrapPassword) redirect('/login?error=unconfigured')
    if (email === bootstrapEmail && password === bootstrapPassword) {
      user = await prisma.user.create({ data: { email, passwordHash: hashPassword(password), role: 'OWNER' } })
      await audit({ actorUserId: user.id, action: 'user.bootstrap_owner', entityType: 'user', entityId: user.id })
    }
  }
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    await audit({ action: 'auth.login_failed', entityType: 'user', metadata: { email } })
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`)
  }

  // One-time bridge from TWISTER's original single-instructor deployment. The
  // invariant is deliberately narrow: exactly one user and no memberships. That
  // user owned every pre-existing course, so promote it and attach memberships
  // atomically. Multi-user installations are never changed implicitly.
  if (count === 1) {
    const memberships = await prisma.courseMembership.count()
    if (memberships === 0) {
      const courses = await prisma.course.findMany({ select: { id: true } })
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { role: 'OWNER' } }),
        ...courses.map((course) => prisma.courseMembership.create({
          data: { userId: user!.id, courseId: course.id, role: 'OWNER', createdById: user!.id },
        })),
      ])
      user = { ...user, role: 'OWNER' }
      await audit({ actorUserId: user.id, action: 'auth.legacy_owner_migrated', entityType: 'user', entityId: user.id, metadata: { courses: courses.length } })
    }
  }

  await setSession(user.id)
  await audit({ actorUserId: user.id, action: 'auth.login_success', entityType: 'user', entityId: user.id })
  redirect(next.startsWith('/') ? next : '/')
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>
}) {
  if (await getSession()) redirect('/')
  const { error, next = '/' } = await searchParams

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">TWISTER</h1>
        <p className="mt-1 text-sm text-slate-600">
          Tests Written Individually via Seeded, Traceable Exam Randomization
        </p>
      </div>

      <Card className="p-5">
        {error === 'unconfigured' ? (
          <div className="mb-4">
            <Notice tone="amber" title="Not configured">
              Set <code className="font-mono">TWISTER_BOOTSTRAP_OWNER_EMAIL</code> and{' '}
              <code className="font-mono">TWISTER_BOOTSTRAP_OWNER_PASSWORD</code> in <code className="font-mono">.env</code>,
              then restart.
            </Notice>
          </div>
        ) : null}
        {error === 'invalid' ? (
          <div className="mb-4">
            <Notice tone="red">Incorrect email or password.</Notice>
          </div>
        ) : null}

        <form action={login} className="space-y-3">
          <input type="hidden" name="next" value={next} />
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
    </main>
  )
}
