import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { uidLabel, type CharacterView } from '@/lib/characters'
import { trpc } from '@/lib/trpc'
import { selectClass, type SendFn } from './shared'

export function ConditionsPanel({ view, send }: { view: CharacterView; send: SendFn }) {
  const { sheet, aggregate } = view
  const [uid, setUid] = useState('')
  const conditions = useQuery(
    trpc.content.entries.list.queryOptions({ kind: 'condition', limit: 50 }),
  )
  const active = aggregate.state.conditions
  return (
    <Card data-testid="conditions">
      <CardHeader>
        <CardTitle>Conditions and toggles</CardTitle>
        <CardDescription>Active conditions, exhaustion and features you switch on.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <ul className="grid gap-1" data-testid="active-conditions">
          {active.length === 0 ? <li className="text-muted-foreground">No conditions.</li> : null}
          {active.map((c) => (
            <li key={c.uid} className="flex items-center justify-between gap-2">
              <span>
                {uidLabel(c.uid)}
                {c.level !== undefined ? ` (${c.level})` : ''}
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="print:hidden"
                onClick={() => void send({ type: 'removeCondition', uid: c.uid })}
                data-testid={`remove-${c.uid}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="grid flex-1 gap-1">
            Add a condition
            <select
              className={selectClass}
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              data-testid="condition-select"
            >
              <option value="">Choose</option>
              {conditions.data?.items
                .filter((c) => !active.some((a) => a.uid === c.uid))
                .map((c) => (
                  <option key={c.uid} value={c.uid}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <Button
            variant="outline"
            disabled={!uid}
            onClick={() => {
              void send({ type: 'applyCondition', uid })
              setUid('')
            }}
            data-testid="condition-add"
          >
            Apply
          </Button>
        </div>
        <label className="flex items-center justify-between gap-2">
          <span>Exhaustion</span>
          <select
            className={`${selectClass} w-24`}
            value={aggregate.state.exhaustion}
            onChange={(e) => void send({ type: 'setExhaustion', level: Number(e.target.value) })}
            data-testid="exhaustion"
          >
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {sheet.toggles.length > 0 ? (
          <ul className="grid gap-1 border-t pt-3" data-testid="toggles">
            {sheet.toggles.map((t) => (
              <li key={t.id}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={t.active}
                    onChange={(e) =>
                      void send({ type: 'toggle', id: t.id, active: e.target.checked })
                    }
                    data-testid={`toggle-${t.id}`}
                  />
                  <span>
                    <span className="font-medium">{t.name}</span>
                    {t.description ? (
                      <span className="block text-xs text-muted-foreground">{t.description}</span>
                    ) : null}
                    {t.durationNote ? (
                      <span className="block text-xs text-muted-foreground">{t.durationNote}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : null}
        {sheet.defenses.length > 0 ? (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            Defenses:{' '}
            {sheet.defenses
              .map((d) => `${d.kind} to ${d.damageType}${d.condition ? ' (conditional)' : ''}`)
              .join(', ')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
