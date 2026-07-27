import Link from 'next/link'
import { redirect } from 'next/navigation'
import { clearSession, getSession } from '@/lib/auth'

async function logout() {
  'use server'
  await clearSession()
  redirect('/login')
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const email = await getSession()
  if (!email) redirect('/login')

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <Link href="/" className="text-sm font-bold tracking-tight text-slate-900">
            TWISTER
          </Link>
          <span className="hidden text-xs text-slate-400 sm:inline">
            seeded, traceable exam randomization
          </span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-slate-500 sm:inline">{email}</span>
            <form action={logout}>
              <button className="text-xs font-medium text-slate-600 hover:text-slate-900">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  )
}
