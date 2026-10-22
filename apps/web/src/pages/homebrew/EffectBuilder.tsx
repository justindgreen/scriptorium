import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { CREATURE_TYPES, DAMAGE_TYPES } from '@scriptorium/content-schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { uidLabel } from '@/lib/characters'
import { trpc } from '@/lib/trpc'
import { selectClass } from '../character/shared'
import { BONUS_TARGETS, USE_RECHARGES, newRow, type BuilderRow } from './effects'

const KIND_LABELS: Record<BuilderRow['kind'], string> = {
  bonus: 'Static bonus',
  extraDamage: 'Extra damage (optionally against creature types)',
  grantedSpell: 'Granted spell',
  manual: 'Manual text (not automated)',
  raw: 'Advanced effect',
}

/**
 * Plain-language rows that become content-schema effects. Static rows apply while the item is
 * equipped (and attuned, when required); extra damage is action-scoped and resolves per attack.
 */
export function EffectBuilder({
  rows,
  onChange,
}: {
  rows: BuilderRow[]
  onChange: (rows: BuilderRow[]) => void
}) {
  const update = (index: number, row: BuilderRow) =>
    onChange(rows.map((r, i) => (i === index ? row : r)))
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index))
  return (
    <div className="grid gap-3" data-testid="effect-builder">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No effects yet. A weapon with no effects is a plain magic weapon.
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div
          key={index}
          className="grid gap-2 rounded-md border p-3"
          data-testid={`effect-${index}`}
        >
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium">{KIND_LABELS[row.kind]}</span>
            <Button size="sm" variant="ghost" onClick={() => remove(index)}>
              Remove
            </Button>
          </div>
          {row.kind === 'bonus' ? (
            <div className="grid gap-2">
              <select
                className={selectClass}
                value={row.target}
                onChange={(e) => update(index, { ...row, target: e.target.value })}
                aria-label="Bonus applies to"
                data-testid={`effect-${index}-target`}
              >
                {BONUS_TARGETS.map((t) => (
                  <option key={t.path} value={t.path}>
                    {t.label}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
                <Input
                  type="number"
                  value={row.value}
                  onChange={(e) => update(index, { ...row, value: e.target.value })}
                  aria-label="Bonus amount"
                  data-testid={`effect-${index}-value`}
                />
                <Input
                  value={row.note}
                  onChange={(e) => update(index, { ...row, note: e.target.value })}
                  placeholder="Note shown in breakdowns"
                  aria-label="Note"
                />
              </div>
            </div>
          ) : null}
          {row.kind === 'extraDamage' ? (
            <div className="grid gap-2">
              <div className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
                <Input
                  value={row.formula}
                  onChange={(e) => update(index, { ...row, formula: e.target.value })}
                  aria-label="Damage dice"
                  placeholder="1d8"
                  data-testid={`effect-${index}-formula`}
                />
                <select
                  className={selectClass}
                  value={row.damageType}
                  onChange={(e) => update(index, { ...row, damageType: e.target.value })}
                  aria-label="Damage type"
                  data-testid={`effect-${index}-damage-type`}
                >
                  {DAMAGE_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <Input
                  value={row.label}
                  onChange={(e) => update(index, { ...row, label: e.target.value })}
                  placeholder="Label, e.g. Fiendbane"
                  aria-label="Label"
                />
              </div>
              <fieldset className="grid gap-1">
                <legend className="text-xs text-muted-foreground">
                  Only against these creature types (none selected: always)
                </legend>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                  {CREATURE_TYPES.map((type) => (
                    <label key={type} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={row.creatureTypes.includes(type)}
                        onChange={(e) =>
                          update(index, {
                            ...row,
                            creatureTypes: e.target.checked
                              ? [...row.creatureTypes, type]
                              : row.creatureTypes.filter((t) => t !== type),
                          })
                        }
                        data-testid={`effect-${index}-type-${type}`}
                      />
                      {type}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}
          {row.kind === 'grantedSpell' ? (
            <GrantedSpellRow row={row} onChange={(next) => update(index, next)} index={index} />
          ) : null}
          {row.kind === 'manual' ? (
            <Input
              value={row.text}
              onChange={(e) => update(index, { ...row, text: e.target.value })}
              placeholder="What the player tracks by hand"
              aria-label="Manual text"
              data-testid={`effect-${index}-text`}
            />
          ) : null}
          {row.kind === 'raw' ? (
            <pre className="overflow-auto rounded bg-muted/40 p-2 text-xs">
              {JSON.stringify(row.effect, null, 1)}
            </pre>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {(['bonus', 'extraDamage', 'grantedSpell', 'manual'] as const).map((kind) => (
          <Button
            key={kind}
            size="sm"
            variant="outline"
            onClick={() => onChange([...rows, newRow(kind)])}
            data-testid={`add-${kind}`}
          >
            + {KIND_LABELS[kind].split(' (')[0]}
          </Button>
        ))}
      </div>
    </div>
  )
}

function GrantedSpellRow({
  row,
  onChange,
  index,
}: {
  row: Extract<BuilderRow, { kind: 'grantedSpell' }>
  onChange: (row: BuilderRow) => void
  index: number
}) {
  const [query, setQuery] = useState('')
  const spells = useQuery({
    ...trpc.content.entries.list.queryOptions({ kind: 'spell', q: query, limit: 12 }),
    enabled: query.length >= 2,
  })
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          Spell:{' '}
          <span className="font-medium" data-testid={`effect-${index}-spell`}>
            {row.spell ? uidLabel(row.spell) : 'none chosen'}
          </span>
        </span>
        <Input
          className="w-56"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search spells…"
          aria-label="Search spells"
          data-testid={`effect-${index}-spell-search`}
        />
      </div>
      {spells.data && query.length >= 2 ? (
        <ul className="flex flex-wrap gap-1">
          {spells.data.items.map((s) => (
            <li key={s.uid}>
              <Button
                size="sm"
                variant={row.spell === s.uid ? 'default' : 'secondary'}
                onClick={() => {
                  onChange({ ...row, spell: s.uid })
                  setQuery('')
                }}
                data-testid={`pick-${s.uid}`}
              >
                {s.name}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          className={selectClass}
          value={row.mode}
          onChange={(e) => onChange({ ...row, mode: e.target.value as typeof row.mode })}
          aria-label="How the spell is paid for"
          data-testid={`effect-${index}-mode`}
        >
          <option value="charges">Costs charges</option>
          <option value="uses">Limited uses</option>
          <option value="atWill">At will</option>
        </select>
        {row.mode === 'charges' ? (
          <Input
            type="number"
            min={1}
            value={row.chargeCost}
            onChange={(e) => onChange({ ...row, chargeCost: e.target.value })}
            aria-label="Charges per cast"
          />
        ) : null}
        {row.mode === 'uses' ? (
          <>
            <Input
              type="number"
              min={1}
              value={row.usesMax}
              onChange={(e) => onChange({ ...row, usesMax: e.target.value })}
              aria-label="Uses"
            />
            <select
              className={selectClass}
              value={row.recharge}
              onChange={(e) =>
                onChange({ ...row, recharge: e.target.value as typeof row.recharge })
              }
              aria-label="Uses recharge"
            >
              {USE_RECHARGES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
    </div>
  )
}
