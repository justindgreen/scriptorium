import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

/** Label + control + optional hint, wired with ids for assistive technology. */
export function FormField(props: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={props.id}>{props.label}</Label>
      {props.children}
      {props.hint ? (
        <p id={`${props.id}-hint`} className="text-xs text-muted-foreground">
          {props.hint}
        </p>
      ) : null}
    </div>
  )
}

/** Inline form error announced to screen readers; renders nothing visible when empty. */
export function FormError(props: { message: string | null }) {
  return (
    <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-destructive">
      {props.message}
    </p>
  )
}
