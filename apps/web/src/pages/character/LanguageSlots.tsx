import { useState } from 'react'
import type { PendingChoice } from '@scriptorium/rules-engine'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { uidLabel } from '@/lib/characters'
import { languageId } from '@/lib/languages'
import { selectClass } from './shared'

const OTHER = '__other__'

/**
 * One select per open slot of a free language or tool choice (issue #5). Picks already known or
 * already saved are disabled, a pick cannot be repeated across slots, "Other…" takes a custom
 * name, and saving fewer than all slots is allowed: the parent submits the earlier picks plus
 * these, because `setChoice` replaces the whole selection.
 */
export function LanguageSlots({
  pending,
  kind,
  known,
  options,
  onSave,
}: {
  pending: PendingChoice
  kind: 'language' | 'tool'
  known: string[]
  options: ReadonlyArray<{ id: string; name: string; exotic?: boolean }>
  onSave: (picked: string[]) => void
}) {
  const empty = () => Array.from({ length: pending.remaining }, () => '')
  const [slots, setSlots] = useState<string[]>(empty)
  const [custom, setCustom] = useState<string[]>(empty)
  const taken = new Set([...known, ...pending.selected])
  const valueOf = (i: number) => (slots[i] === OTHER ? languageId(custom[i] ?? '') : slots[i]!)
  const picked = slots.map((_, i) => valueOf(i)).filter(Boolean)
  const repeated = new Set(picked).size !== picked.length
  const alreadyKnown = picked.filter((p) => taken.has(p))
  const setSlot = (i: number, value: string) =>
    setSlots((current) => current.map((s, j) => (j === i ? value : s)))
  const setCustomAt = (i: number, value: string) =>
    setCustom((current) => current.map((s, j) => (j === i ? value : s)))
  return (
    <div className="grid gap-2">
      {pending.selected.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid={`chosen-${pending.key}`}>
          Already chosen: {pending.selected.map(uidLabel).join(', ')}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {slots.map((slot, i) => (
          <div key={i} className="grid gap-1">
            {options.length > 0 ? (
              <select
                className={selectClass}
                value={slot}
                onChange={(e) => setSlot(i, e.target.value)}
                aria-label={`${pending.name} ${i + 1}`}
                data-testid={`slot-${pending.key}-${i}`}
              >
                <option value="">Choose…</option>
                {options.map((o) => {
                  const disabled = taken.has(o.id) || slots.some((s, j) => j !== i && s === o.id)
                  return (
                    <option key={o.id} value={o.id} disabled={disabled}>
                      {o.name}
                      {o.exotic ? ' (exotic)' : ''}
                      {taken.has(o.id) ? ' — known' : ''}
                    </option>
                  )
                })}
                <option value={OTHER}>Other…</option>
              </select>
            ) : null}
            {options.length === 0 || slot === OTHER ? (
              <Input
                value={custom[i] ?? ''}
                onChange={(e) => setCustomAt(i, e.target.value)}
                placeholder={kind === 'language' ? 'Language name' : 'e.g. smiths-tools'}
                aria-label={`${pending.name} ${i + 1}, other`}
                data-testid={`slot-${pending.key}-${i}-other`}
              />
            ) : null}
          </div>
        ))}
      </div>
      {repeated ? <p className="text-xs text-destructive">Each pick must be different.</p> : null}
      {alreadyKnown.length > 0 ? (
        <p className="text-xs text-destructive">
          Already known: {alreadyKnown.map(uidLabel).join(', ')}.
        </p>
      ) : null}
      <div>
        <Button
          size="sm"
          disabled={picked.length === 0 || repeated || alreadyKnown.length > 0}
          onClick={() => onSave(picked)}
          data-testid={`save-${pending.key}`}
        >
          Save
        </Button>
      </div>
    </div>
  )
}
