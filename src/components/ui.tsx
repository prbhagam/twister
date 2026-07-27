import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'

export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & ComponentProps<'div'>) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

const BUTTON_VARIANTS = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-400',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
} as const

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: { variant?: keyof typeof BUTTON_VARIANTS } & ComponentProps<'button'>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
}

export function LinkButton({
  variant = 'secondary',
  className = '',
  ...rest
}: { variant?: keyof typeof BUTTON_VARIANTS } & ComponentProps<typeof Link>) {
  return (
    <Link
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
}

export function Input({ className = '', ...rest }: ComponentProps<'input'>) {
  return (
    <input
      className={`w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none ${className}`}
      {...rest}
    />
  )
}

export function Textarea({ className = '', ...rest }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={`w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-[13px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none ${className}`}
      {...rest}
    />
  )
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-slate-600">
      {children}
    </label>
  )
}

const BADGE_TONES = {
  neutral: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-100 text-emerald-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-900',
  blue: 'bg-blue-100 text-blue-800',
} as const

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof BADGE_TONES
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-slate-500">{children}</p>
}

export function Notice({
  tone = 'blue',
  title,
  children,
}: {
  tone?: 'blue' | 'red' | 'amber' | 'green'
  title?: ReactNode
  children?: ReactNode
}) {
  const tones = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }
  return (
    <div className={`rounded-md border px-3.5 py-2.5 text-sm ${tones[tone]}`}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children}
    </div>
  )
}

/** Renders pipeline output from lib/markdown. Content is instructor-authored. */
export function Markdown({ html, className = '' }: { html: string; className?: string }) {
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />
}
