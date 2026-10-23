import type { ReactNode } from 'react'

/**
 * A named region of the sheet (issue #4): play controls, character details, equipment, things
 * that need attention, management. The heading is small and quiet; the cards inside carry the
 * weight. Landmarks and ids give assistive technology and tests something to hold on to.
 */
export function SheetSection({
  id,
  title,
  hint,
  children,
  className,
}: {
  id: string
  title: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      aria-labelledby={`section-${id}-title`}
      data-testid={`section-${id}`}
      className={`grid min-w-0 grid-cols-1 gap-3 ${className ?? ''}`}
    >
      <div className="flex flex-wrap items-baseline gap-2 border-b pb-1">
        <h2
          id={`section-${id}-title`}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {title}
        </h2>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}
