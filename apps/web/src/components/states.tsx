import { AlertTriangleIcon, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Title block at the top of a page: display-font heading, optional description and actions. */
export function PageHeader(props: {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-wrap items-end justify-between gap-4', props.className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{props.title}</h1>
        {props.description ? (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{props.description}</p>
        ) : null}
      </div>
      {props.actions ? (
        <div className="flex shrink-0 items-center gap-2">{props.actions}</div>
      ) : null}
    </div>
  )
}

/** Shown when a list has nothing in it yet; always says what to do next. */
export function EmptyState(props: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
  /** Use 1 when the empty state is the whole page (e.g. not found). */
  headingLevel?: 1 | 2
}) {
  const Icon = props.icon
  const Heading = props.headingLevel === 1 ? 'h1' : 'h2'
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center',
        props.className,
      )}
    >
      {Icon ? <Icon className="mb-3 size-8 text-muted-foreground" aria-hidden="true" /> : null}
      <Heading className="text-base font-semibold">{props.title}</Heading>
      {props.description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{props.description}</p>
      ) : null}
      {props.action ? <div className="mt-4">{props.action}</div> : null}
    </div>
  )
}

/** Shown when loading failed; offers to try again. */
export function ErrorState(props: {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-10 text-center',
        props.className,
      )}
    >
      <AlertTriangleIcon className="mb-3 size-8 text-destructive" aria-hidden="true" />
      <h2 className="text-base font-semibold">{props.title ?? 'Something went wrong'}</h2>
      {props.message ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{props.message}</p>
      ) : null}
      {props.onRetry ? (
        <Button variant="outline" className="mt-4" onClick={props.onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}

/** Skeleton rows while a page loads. */
export function LoadingState(props: { rows?: number; className?: string; label?: string }) {
  const rows = props.rows ?? 4
  return (
    <div
      className={cn('space-y-3', props.className)}
      role="status"
      aria-live="polite"
      aria-label={props.label ?? 'Loading'}
    >
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
      <span className="sr-only">{props.label ?? 'Loading'}</span>
    </div>
  )
}
