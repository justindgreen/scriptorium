import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { CharacterView } from '@/lib/characters'
import { errorMessage, trpcClient } from '@/lib/trpc'
import type { SendFn } from './shared'

type Die = 'd4' | 'd6' | 'd8' | 'd10' | 'd12'

export function ResourcesPanel({
  view,
  send,
  onError,
}: {
  view: CharacterView
  send: SendFn
  onError: (message: string | null) => void
}) {
  const { sheet } = view
  const casting = sheet.spellcasting
  const slots = casting?.slots.filter((s) => s.max > 0) ?? []
  return (
    <Card data-testid="resources">
      <CardHeader>
        <CardTitle>Resources and rests</CardTitle>
        <CardDescription>
          Uses, spell slots and hit dice. Rests restore what the rules say they restore.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {sheet.resources.length > 0 ? (
          <ul className="grid gap-1 text-sm">
            {sheet.resources.map((r) => {
              const max = typeof r.max.value === 'number' ? r.max.value : 0
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{r.name}</span>{' '}
                    <span className="tabular" data-testid={`resource-${r.id}`}>
                      {r.current}/{max}
                    </span>
                    {r.displayDie ? ` (${r.displayDie})` : ''}
                    <span className="text-muted-foreground">
                      {' '}
                      · {r.recharge.replace(/([A-Z])/g, ' $1').toLowerCase()}
                    </span>
                  </span>
                  <span className="flex gap-1 print:hidden">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={r.current <= 0}
                      onClick={() => void send({ type: 'useResource', id: r.id })}
                      data-testid={`use-${r.id}`}
                    >
                      Use
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={r.current >= max}
                      onClick={() => void send({ type: 'restoreResource', id: r.id })}
                    >
                      Restore
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : null}
        {slots.length > 0 || casting?.pact ? (
          <ul className="grid gap-1 text-sm" data-testid="spell-slots">
            {slots.map((s) => (
              <li key={s.level} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Level {s.level} slots{' '}
                  <span className="tabular" data-testid={`slots-${s.level}`}>
                    {s.max - s.used}/{s.max}
                  </span>
                </span>
                <span className="flex gap-1 print:hidden">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={s.used >= s.max}
                    onClick={() => void send({ type: 'spendSlot', level: s.level })}
                    data-testid={`spend-slot-${s.level}`}
                  >
                    Spend
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={s.used <= 0}
                    onClick={() => void send({ type: 'restoreSlot', level: s.level })}
                  >
                    Restore
                  </Button>
                </span>
              </li>
            ))}
            {casting?.pact ? (
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Pact slots (level {casting.pact.level}){' '}
                  <span className="tabular" data-testid="pact-slots">
                    {casting.pact.slots - casting.pact.used}/{casting.pact.slots}
                  </span>
                </span>
                <span className="flex gap-1 print:hidden">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={casting.pact.used >= casting.pact.slots}
                    onClick={() => void send({ type: 'spendPactSlot' })}
                  >
                    Spend
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={casting.pact.used <= 0}
                    onClick={() => void send({ type: 'restorePactSlot' })}
                  >
                    Restore
                  </Button>
                </span>
              </li>
            ) : null}
          </ul>
        ) : null}
        <Rests view={view} send={send} onError={onError} />
      </CardContent>
    </Card>
  )
}

function Rests({
  view,
  send,
  onError,
}: {
  view: CharacterView
  send: SendFn
  onError: (message: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  // Hit dice to spend during the short rest, each with what it showed (typed or server-rolled).
  const [dice, setDice] = useState<Array<{ die: Die; roll: string }>>([])
  const rollDie = useMutation({
    mutationFn: (index: number) =>
      trpcClient.characters.rollHitDie
        .mutate({ characterId: view.id, die: dice[index]!.die })
        .then((r) => ({ index, roll: r.roll })),
    onSuccess: ({ index, roll }) =>
      setDice((d) => d.map((entry, i) => (i === index ? { ...entry, roll: String(roll) } : entry))),
    onError: (e) => onError(errorMessage(e)),
  })
  const remaining = (die: string) => {
    const pool = view.sheet.hitDice.find((h) => h.die === die)
    return pool ? pool.max - pool.spent - dice.filter((d) => d.die === die).length : 0
  }
  const finish = async () => {
    await send({
      type: 'shortRest',
      hitDice: dice.filter((d) => d.roll !== '').map((d) => ({ die: d.die, roll: Number(d.roll) })),
    })
    setDice([])
    setOpen(false)
  }
  return (
    <div className="grid gap-2 border-t pt-3 print:hidden">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setOpen((o) => !o)} data-testid="short-rest">
          Short rest
        </Button>
        <ConfirmButton
          testId="long-rest"
          variant="outline"
          label="Long rest"
          title="Take a long rest?"
          description="Restores hit points, spent hit dice, spell slots and the resources that recover on a long rest. A snapshot is taken first; the rest itself cannot be undone."
          confirmLabel="Finish the long rest"
          onConfirm={() => void send({ type: 'longRest' })}
        />
      </div>
      {open ? (
        <div className="grid gap-2 rounded-md border p-2 text-sm" data-testid="short-rest-form">
          <p className="text-muted-foreground">
            Spend hit dice: each die heals what it shows plus your Constitution modifier (the engine
            adds it).
          </p>
          <div className="flex flex-wrap gap-2">
            {view.sheet.hitDice.map((h) => (
              <Button
                key={h.die}
                size="sm"
                variant="secondary"
                disabled={remaining(h.die) <= 0}
                onClick={() => setDice((d) => [...d, { die: h.die as Die, roll: '' }])}
                data-testid={`spend-hit-die-${h.die}`}
              >
                Spend a {h.die} ({remaining(h.die)} left)
              </Button>
            ))}
          </div>
          {dice.map((d, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-10">{d.die}</span>
              <Input
                type="number"
                min={1}
                max={Number(d.die.slice(1))}
                className="w-20"
                value={d.roll}
                onChange={(e) =>
                  setDice((all) =>
                    all.map((x, j) => (j === i ? { ...x, roll: e.target.value } : x)),
                  )
                }
                aria-label={`${d.die} result`}
                data-testid={`hit-die-roll-${i}`}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={rollDie.isPending}
                onClick={() => rollDie.mutate(i)}
                data-testid={`roll-hit-die-${i}`}
              >
                Roll it
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDice((all) => all.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              disabled={dice.some((d) => d.roll === '')}
              onClick={() => void finish()}
              data-testid="finish-short-rest"
            >
              Finish short rest
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
