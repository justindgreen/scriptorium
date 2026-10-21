import type { InputHTMLAttributes, ReactNode } from 'react'

/** Small, accessible form primitives used until the design system (M1.4) replaces them. */

export function Field(props: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={props.id} className="text-sm font-medium">
        {props.label}
      </label>
      {props.children}
      {props.hint ? (
        <p id={`${props.id}-hint`} className="text-xs opacity-70">
          {props.hint}
        </p>
      ) : null}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 ${props.className ?? ''}`}
    />
  )
}

export function PrimaryButton(props: {
  children: ReactNode
  disabled?: boolean
  type?: 'submit' | 'button'
  onClick?: () => void
}) {
  return (
    <button
      type={props.type ?? 'submit'}
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
    >
      {props.children}
    </button>
  )
}

export function SecondaryButton(props: {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      aria-label={props.ariaLabel}
      className="rounded border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:hover:bg-stone-800"
    >
      {props.children}
    </button>
  )
}

export function FormError(props: { message: string | null }) {
  return (
    <p
      role="alert"
      aria-live="assertive"
      className="min-h-5 text-sm text-red-700 dark:text-red-400"
    >
      {props.message}
    </p>
  )
}

export function PageTitle(props: { children: ReactNode; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{props.children}</h1>
      {props.subtitle ? <p className="mt-1 text-sm opacity-80">{props.subtitle}</p> : null}
    </div>
  )
}
