import { useState } from 'react'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { CharacterView } from '@/lib/characters'
import { selectClass, type SendFn } from './shared'

/** Stat paths a player may override by hand; the engine keeps the automatic value alongside. */
const OVERRIDABLE =
  /^(ac\.total|hp\.max|initiative\.bonus|speed\.\w+|proficiencyBonus|ability\.\w+\.score|save\.\w+\.bonus|skill\.\w+\.bonus|passive\.\w+|spell\.saveDC|spell\.attack)$/

export function OverridesPanel({ view, send }: { view: CharacterView; send: SendFn }) {
  const { sheet, aggregate } = view
  const [statPath, setStatPath] = useState('')
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const paths = Object.keys(sheet.stats)
    .filter((p) => OVERRIDABLE.test(p) && sheet.stats[p]?.kind === 'number')
    .sort()
  return (
    <Card data-testid="overrides">
      <CardHeader>
        <CardTitle>Overrides</CardTitle>
        <CardDescription>
          A manual value replaces the engine’s; the automatic value stays visible under “Why?”.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {aggregate.definition.overrides.length > 0 ? (
          <ul className="grid gap-1" data-testid="override-list">
            {aggregate.definition.overrides.map((o) => (
              <li key={o.statPath} className="flex items-center justify-between gap-2">
                <span>
                  <code>{o.statPath}</code> = {String(o.value)}
                  <span className="text-muted-foreground">
                    {' '}
                    (engine: {String(sheet.stats[o.statPath]?.override?.auto ?? '?')})
                    {o.note ? ` · ${o.note}` : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="print:hidden"
                  onClick={() => void send({ type: 'clearOverride', statPath: o.statPath })}
                  data-testid={`clear-override-${o.statPath}`}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No overrides.</p>
        )}
        <div className="grid gap-2 print:hidden">
          <FormField id="override-path" label="Stat">
            <select
              id="override-path"
              className={selectClass}
              value={statPath}
              onChange={(e) => setStatPath(e.target.value)}
              data-testid="override-path"
            >
              <option value="">Choose</option>
              {paths.map((p) => (
                <option key={p} value={p}>
                  {p} ({String(sheet.stats[p]?.value)})
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-end gap-2">
            <FormField id="override-value" label="Value">
              <Input
                id="override-value"
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                data-testid="override-value"
              />
            </FormField>
            <FormField id="override-note" label="Note">
              <Input id="override-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </FormField>
            <Button
              variant="outline"
              disabled={!statPath || value === ''}
              onClick={() => {
                void send({
                  type: 'setOverride',
                  statPath,
                  value: Number(value),
                  ...(note ? { note } : {}),
                })
                setValue('')
                setNote('')
              }}
              data-testid="override-set"
            >
              Override
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
