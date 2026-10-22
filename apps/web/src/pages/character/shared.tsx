import type { ComputedSheet, StatValue } from '@scriptorium/rules-engine'
import { ABILITY_NAMES, type AbilityKey, type useCommand } from '@/lib/characters'

export type SendFn = (
  cmd: Parameters<ReturnType<typeof useCommand>['mutateAsync']>[0]['command'],
) => Promise<void>

export const ABILITIES = Object.keys(ABILITY_NAMES) as AbilityKey[]

/** Native select styling without a width; `selectClass` adds `w-full`. */
export const selectBase =
  'h-9 min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
export const selectClass = `${selectBase} w-full`

export function num(sheet: ComputedSheet, path: string): number {
  const v = sheet.stats[path]?.value
  return typeof v === 'number' ? v : 0
}

export function stat(sheet: ComputedSheet, path: string): StatValue | undefined {
  return sheet.stats[path]
}

/** Skill ids the sheet publishes (`skill.<id>.bonus`), in sheet order. */
export function skillIds(sheet: ComputedSheet): string[] {
  return Object.keys(sheet.stats)
    .filter((p) => p.startsWith('skill.') && p.endsWith('.bonus'))
    .map((p) => p.split('.')[1]!)
}

function formatValue(value: StatValue['value'] | null): string {
  if (value === null) return '?'
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

/** The "Why?" view: every contribution the engine applied (and the ones it did not). */
export function Breakdown({ value, label }: { value: StatValue | undefined; label?: string }) {
  if (!value || value.breakdown.length === 0) return null
  return (
    <details className="text-xs print:hidden">
      <summary className="cursor-pointer text-muted-foreground">{label ?? 'Why?'}</summary>
      <ul className="mt-1 grid gap-0.5">
        {value.breakdown.map((line, i) => (
          <li key={i} className={line.applied ? '' : 'text-muted-foreground line-through'}>
            {line.source.name}: {line.op} {formatValue(line.value)}
            {line.label ? ` (${line.label})` : ''}
            {line.note ? ` — ${line.note}` : ''}
          </li>
        ))}
        {value.override ? (
          <li className="font-medium">
            Manual override {formatValue(value.override.manual)} (engine value{' '}
            {formatValue(value.override.auto)})
            {value.override.note ? `: ${value.override.note}` : ''}
          </li>
        ) : null}
      </ul>
    </details>
  )
}

export const CREATURE_TYPES = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const

export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const
