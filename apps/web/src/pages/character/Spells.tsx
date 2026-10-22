import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { modifier, uidLabel, type CharacterView } from '@/lib/characters'
import { trpc } from '@/lib/trpc'
import { ActionCard } from './ActionCard'
import { selectClass, type SendFn } from './shared'

export function Spells({
  view,
  send,
  onError,
}: {
  view: CharacterView
  send: SendFn
  onError: (message: string | null) => void
}) {
  const casting = view.sheet.spellcasting!
  const [query, setQuery] = useState('')
  const [cast, setCast] = useState<{ spellUid: string; level: number; slot: string } | null>(null)
  const slotChoices = (level: number) => [
    ...casting.slots.filter((s) => s.max > 0 && s.level >= level).map((s) => String(s.level)),
    ...(casting.pact && casting.pact.level >= level ? ['pact'] : []),
  ]
  const spells = useQuery({
    ...trpc.content.entries.list.queryOptions({ kind: 'spell', q: query || undefined, limit: 30 }),
    enabled: query.length >= 2,
  })
  const primary = casting.sources.find((s) => s.id === casting.primary)
  const origin = primary?.classUid ? `class:${primary.classUid}` : 'class:unknown'
  const setPrepared = (spellUid: string, prepared: boolean) =>
    send({
      type: 'setSpells',
      spells: view.aggregate.definition.spells.map((s) =>
        s.spellUid === spellUid ? { ...s, prepared } : s,
      ),
    })
  const remove = (spellUid: string) =>
    send({
      type: 'setSpells',
      spells: view.aggregate.definition.spells.filter((s) => s.spellUid !== spellUid),
    })
  const add = (spellUid: string) =>
    send({
      type: 'setSpells',
      spells: [
        ...view.aggregate.definition.spells,
        { spellUid, origin, known: true, prepared: false, alwaysPrepared: false },
      ],
    })
  return (
    <Card data-testid="spells">
      <CardHeader>
        <CardTitle>Spells</CardTitle>
        <CardDescription>
          {casting.sources
            .map(
              (s) =>
                `${s.name}: DC ${s.saveDC}, attack ${modifier(s.attack)}${s.preparedMax !== undefined ? `, prepare ${s.preparedMax}` : ''}${s.spellsKnown !== undefined ? `, know ${s.spellsKnown}` : ''}`,
            )
            .join(' · ')}
          {casting.slots.length
            ? ` · slots ${casting.slots.map((s) => `${s.max - s.used}/${s.max} L${s.level}`).join(', ')}`
            : ''}
          {casting.pact
            ? ` · pact ${casting.pact.slots - casting.pact.used}/${casting.pact.slots} L${casting.pact.level}`
            : ''}
          {casting.blocked ? ` · ${casting.blocked}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {casting.known.map((k) => (
            <li
              key={`${k.origin}:${k.spellUid}`}
              className="flex items-center justify-between gap-2"
            >
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={k.prepared}
                  disabled={k.alwaysPrepared || k.cantrip || !k.origin.startsWith('class:')}
                  onChange={(e) => void setPrepared(k.spellUid, e.target.checked)}
                />
                {uidLabel(k.spellUid)}
                {k.level !== undefined ? (
                  <span className="text-muted-foreground"> L{k.level}</span>
                ) : null}
                {k.alwaysPrepared ? <Badge variant="secondary">always</Badge> : null}
              </label>
              <span className="flex gap-1 print:hidden">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    Boolean(casting.blocked) || (!k.prepared && !k.alwaysPrepared && !k.cantrip)
                  }
                  onClick={() =>
                    setCast({
                      spellUid: k.spellUid,
                      level: k.level ?? 0,
                      slot: k.cantrip ? '' : (slotChoices(k.level ?? 0)[0] ?? ''),
                    })
                  }
                  data-testid={`cast-${k.spellUid}`}
                >
                  Cast
                </Button>
                {view.aggregate.definition.spells.some((s) => s.spellUid === k.spellUid) ? (
                  <Button size="sm" variant="ghost" onClick={() => void remove(k.spellUid)}>
                    Remove
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {cast ? (
          <div className="grid gap-2 print:hidden" data-testid="cast-area">
            {cast.level > 0 ? (
              <label className="flex items-center gap-2 text-sm">
                Cast with
                <select
                  className={`${selectClass} w-auto`}
                  value={cast.slot}
                  onChange={(e) => setCast({ ...cast, slot: e.target.value })}
                  data-testid="cast-slot"
                >
                  {slotChoices(cast.level).map((s) => (
                    <option key={s} value={s}>
                      {s === 'pact' ? 'a pact slot' : `a level ${s} slot`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <ActionCard
              key={`${cast.spellUid}-${cast.slot}`}
              characterId={view.id}
              revision={view.revision}
              actionRef={{
                kind: 'spell',
                spellUid: cast.spellUid,
                ...(cast.slot === 'pact'
                  ? { usePact: true }
                  : cast.slot
                    ? { slotLevel: Number(cast.slot) }
                    : {}),
              }}
              title={`Cast ${uidLabel(cast.spellUid)}`}
              send={send}
              onError={onError}
              testId="action-spell"
            />
          </div>
        ) : null}
        <Input
          placeholder="Add a spell: search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search spells"
        />
        {spells.data && query.length >= 2 ? (
          <ul className="grid max-h-48 gap-1 overflow-auto sm:grid-cols-2">
            {spells.data.items.map((e) => (
              <li key={e.uid}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto w-full justify-start py-1 text-left"
                  onClick={() => void add(e.uid)}
                >
                  {e.name} <span className="text-muted-foreground">L{e.spell?.level ?? '?'}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
