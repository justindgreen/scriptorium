import { useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'

/**
 * A two-step action: the first press opens an inline prompt that says what will happen, the
 * second press does it. Used for the irreversible sheet actions (issue #6): rests, level-ups,
 * reverting a level-up, deleting. Inline rather than modal so it works the same on a phone and
 * is reachable by keyboard; the prompt carries `${testId}-prompt`, `-confirm` and `-cancel`.
 */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = 'Confirm',
  onConfirm,
  disabled,
  variant = 'default',
  size,
  testId,
  className,
}: {
  label: string
  title: string
  description?: string
  confirmLabel?: string
  onConfirm: () => void
  disabled?: boolean
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  testId: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  if (!open)
    return (
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid={testId}
        className={className}
      >
        {label}
      </Button>
    )
  return (
    <div
      className="grid gap-2 rounded-md border border-primary/40 bg-accent/30 p-3 text-sm"
      role="group"
      aria-label={title}
      data-testid={`${testId}-prompt`}
    >
      <p className="font-medium">{title}</p>
      {description ? <p className="text-muted-foreground">{description}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={variant === 'outline' || variant === 'ghost' ? 'default' : variant}
          onClick={() => {
            setOpen(false)
            onConfirm()
          }}
          data-testid={`${testId}-confirm`}
        >
          {confirmLabel}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          data-testid={`${testId}-cancel`}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
