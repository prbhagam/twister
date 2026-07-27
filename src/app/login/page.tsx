import { redirect } from 'next/navigation'
import { getSession, hashPassword, setSession, verifyPassword } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { audit } from '@/lib/audit'
import { Button, Card, Input, Label, Notice } from '@/components/ui'

/**
 * Controlled local instructor login. Credentials remain in the environment as in
 * the original application; the persisted row only holds a secure password hash.
 */
async function login(formData: FormData) {
  'use server'

  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const next = String(formData.get('next') ?? '/')

  const adminEmail = (process.env.TWISTER_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const adminPassword = process.env.TWISTER_ADMIN_PASSWORD ?? ''
  if (!adminEmail || !adminPassword) redirect('/login?error=unconfigured')
  if (email !== adminEmail || password !== adminPassword) {
    await audit({ action: 'auth.login_failed', entityType: 'user', metadata: { email } })
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`)
  }
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) user = await prisma.user.create({ data: { email, passwordHash: hashPassword(password), role: 'OWNER' } })
  else if (!user.active || !verifyPassword(password, user.passwordHash)) {
    user = await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password), active: true, role: 'OWNER' } })
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
              Set <code className="font-mono">TWISTER_ADMIN_EMAIL</code> and{' '}
              <code className="font-mono">TWISTER_ADMIN_PASSWORD</code> in <code className="font-mono">.env</code>,
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
