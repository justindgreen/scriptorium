import { useState } from 'react'
import type { ComputedSheet } from '@scriptorium/rules-engine'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { modifier, uidLabel, type CharacterView } from '@/lib/characters'
import { ABILITIES, Breakdown, num, skillIds, stat, type SendFn } from './shared'

export function Vitals({ view, send }: { view: CharacterView; send: SendFn }) {
  const { sheet } = view
  const [amount, setAmount] = useState(5)
  const inspiration = view.aggregate.state.inspiration
  return (
    <Card data-testid="vitals">
      <CardHeader>
        <CardTitle>Vitals</CardTitle>
        <CardDescription>
          Computed by the rules engine; open “Why?” under a number for its breakdown.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid grid-cols-3 gap-3 text-sm sm:grid-cols-6">
          {ABILITIES.map((a) => (
            <div key={a} className="rounded-md border p-2 text-center">
              <dt className="text-xs uppercase text-muted-foreground">{a}</dt>
              <dd className="text-xl font-semibold tabular" data-testid={`score-${a}`}>
                {num(sheet, `ability.${a}.score`)}
              </dd>
              <dd className="text-xs text-muted-foreground">
                {modifier(num(sheet, `ability.${a}.mod`))}
              </dd>
              <dd className="text-xs">save {modifier(num(sheet, `save.${a}.bonus`))}</dd>
            </div>
          ))}
        </dl>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted-foreground">Armor class</dt>
          <dd>
            <span data-testid="stat-ac">{num(sheet, 'ac.total')}</span>
            <Breakdown value={stat(sheet, 'ac.total')} />
          </dd>
          <dt className="text-muted-foreground">Hit points</dt>
          <dd>
            <span data-testid="stat-hp">
              {sheet.hp.current} / {sheet.hp.max}
              {sheet.hp.temp ? ` (+${sheet.hp.temp} temp)` : ''}
            </span>
            <Breakdown value={stat(sheet, 'hp.max')} label="Why this maximum?" />
          </dd>
          <dt className="text-muted-foreground">Proficiency</dt>
          <dd>{modifier(num(sheet, 'proficiencyBonus'))}</dd>
          <dt className="text-muted-foreground">Speed</dt>
          <dd>
            <span data-testid="stat-speed">{num(sheet, 'speed.walk')} ft.</span>
            <Breakdown value={stat(sheet, 'speed.walk')} />
          </dd>
          <dt className="text-muted-foreground">Initiative</dt>
          <dd>
            {modifier(num(sheet, 'initiative.bonus'))}
            <Breakdown value={stat(sheet, 'initiative.bonus')} />
          </dd>
          <dt className="text-muted-foreground">Hit dice</dt>
          <dd>
            {sheet.hitDice.map((h) => `${h.max - h.spent}/${h.max} ${h.die}`).join(', ') || '—'}
          </dd>
          <dt className="text-muted-foreground">Passive Perception</dt>
          <dd>{num(sheet, 'passive.perception')}</dd>
          <dt className="text-muted-foreground">Inspiration</dt>
          <dd>
            <Button
              size="sm"
              variant={inspiration ? 'default' : 'outline'}
              onClick={() => void send({ type: 'setInspiration', value: !inspiration })}
              aria-pressed={inspiration}
              data-testid="inspiration"
            >
              {inspiration ? 'Inspired' : 'None'}
            </Button>
          </dd>
        </dl>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <FormField id="hp-amount" label="Amount">
            <Input
              id="hp-amount"
              type="number"
              min={0}
              className="w-24"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </FormField>
          <Button
            variant="outline"
            onClick={() => void send({ type: 'applyDamage', amount })}
            data-testid="damage"
          >
            Damage
          </Button>
          <Button
            variant="outline"
            onClick={() => void send({ type: 'heal', amount })}
            data-testid="heal"
          >
            Heal
          </Button>
          <Button
            variant="outline"
            onClick={() => void send({ type: 'setTempHp', amount })}
            data-testid="temp-hp"
          >
            Set temp HP
          </Button>
        </div>
        <Skills sheet={sheet} />
      </CardContent>
    </Card>
  )
}

function Skills({ sheet }: { sheet: ComputedSheet }) {
  const ids = skillIds(sheet)
  if (ids.length === 0) return null
  return (
    <details data-testid="skills">
      <summary className="cursor-pointer text-sm font-medium">Skills</summary>
      <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        {ids.map((id) => {
          const proficiency = num(sheet, `skill.${id}.proficiency`)
          return (
            <li key={id} className="flex justify-between gap-2">
              <span>
                {uidLabel(id)}
                {proficiency >= 2 ? ' ◆' : proficiency >= 1 ? ' ●' : ''}
              </span>
              <span className="tabular">{modifier(num(sheet, `skill.${id}.bonus`))}</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">● proficient · ◆ expertise</p>
    </details>
  )
}
