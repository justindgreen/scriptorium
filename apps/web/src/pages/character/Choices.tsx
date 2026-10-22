import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ChoiceSelection, PendingChoice } from '@scriptorium/rules-engine'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { uidLabel, type AbilityKey, type CharacterView } from '@/lib/characters'
import { trpc } from '@/lib/trpc'
import { ABILITIES, type SendFn } from './shared'

export function PendingChoices({ view, send }: { view: CharacterView; send: SendFn }) {
  const pending = view.sheet.pendingChoices
  if (pending.length === 0) return null
  return (
    <Card data-testid="pending-choices">
      <CardHeader>
        <CardTitle>Choices to make</CardTitle>
        <CardDescription>
          {pending.length} open. The engine lists only legal options.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {pending.map((p) => (
          <ChoicePicker key={p.key} pending={p} view={view} send={send} />
        ))}
      </CardContent>
    </Card>
  )
}

function ChoicePicker({
  pending,
  view,
  send,
}: {
  pending: PendingChoice
  view: CharacterView
  send: SendFn
}) {
  const kind = pending.from.kind as string
  const [picked, setPicked] = useState<string[]>([])
  const [increases, setIncreases] = useState<Partial<Record<AbilityKey, number>>>({})
  const [asiMode, setAsiMode] = useState<'asi' | 'feat'>('asi')
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const contentKind = (pending.from as { contentKind?: string }).contentKind
  const filter = ((
    pending.from as { filter?: { tags?: string[]; level?: number; maxLevel?: number } }
  ).filter ?? {}) as { tags?: string[]; level?: number; maxLevel?: number }
  const needsSearch = kind === 'content' || kind === 'feat' || asiMode === 'feat'
  const search = useQuery({
    ...trpc.content.entries.list.queryOptions({
      kind: (kind === 'feat' || (kind === 'asiOrFeat' && asiMode === 'feat')
        ? 'feat'
        : (contentKind ?? 'feature')) as 'feat',
      q: query || undefined,
      tags: filter.tags,
      limit: 50,
    }),
    enabled: needsSearch,
  })
  const toggle = (id: string) =>
    setPicked((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length < pending.remaining + pending.selected.length
          ? [...current, id]
          : current,
    )

  const save = () => {
    let selection: ChoiceSelection | null = null
    const ids = [...new Set([...pending.selected.filter((s) => !s.includes('+')), ...picked])]
    switch (kind) {
      case 'optionSet':
        selection = { kind: 'optionSet', options: ids }
        break
      case 'skill':
        selection = {
          kind: 'skill',
          skills: ids as ChoiceSelection extends { skills: infer S } ? S : never,
        }
        break
      case 'expertise':
        selection = { kind: 'expertise', skills: ids as never }
        break
      case 'tool':
        selection = {
          kind: 'tool',
          tools: pending.options
            ? ids
            : text
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
        }
        break
      case 'language':
        selection = {
          kind: 'language',
          languages: pending.options
            ? ids
            : text
                .split(',')
                .map((s) => s.trim().toLowerCase().replace(/\s+/g, '-'))
                .filter(Boolean),
        }
        break
      case 'abilityIncrease':
        selection = { kind: 'abilityIncrease', increases }
        break
      case 'asiOrFeat':
        selection =
          asiMode === 'asi'
            ? { kind: 'asiOrFeat', choice: 'asi', increases }
            : { kind: 'asiOrFeat', choice: 'feat', feat: picked[0] ?? '' }
        break
      case 'feat':
        selection = { kind: 'feat', feats: picked }
        break
      case 'content':
        selection = { kind: 'content', entries: ids }
        break
    }
    if (selection) void send({ type: 'setChoice', key: pending.key, selection })
  }

  const proficientSkills = Object.keys(view.sheet.stats)
    .filter(
      (p) =>
        p.startsWith('skill.') && p.endsWith('.proficiency') && view.sheet.stats[p]?.value === 1,
    )
    .map((p) => p.split('.')[1]!)
  const options: Array<{ id: string; name: string; disabledReason?: string }> | undefined =
    pending.options ??
    (kind === 'expertise' ? proficientSkills.map((s) => ({ id: s, name: uidLabel(s) })) : undefined)

  return (
    <div className="grid gap-2 rounded-md border p-3" data-testid={`choice-${pending.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{pending.name}</span>
        <span className="text-xs text-muted-foreground">
          {pending.source.name} · choose {pending.remaining} more
        </span>
      </div>
      {kind === 'asiOrFeat' ? (
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={asiMode === 'asi'} onChange={() => setAsiMode('asi')} />{' '}
            Ability scores
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={asiMode === 'feat'} onChange={() => setAsiMode('feat')} />{' '}
            Feat
          </label>
        </div>
      ) : null}
      {kind === 'abilityIncrease' || (kind === 'asiOrFeat' && asiMode === 'asi') ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ABILITIES.map((a) => (
            <FormField key={a} id={`${pending.key}-${a}`} label={a.toUpperCase()}>
              <Input
                id={`${pending.key}-${a}`}
                type="number"
                min={0}
                max={2}
                value={increases[a] ?? 0}
                onChange={(e) => setIncreases({ ...increases, [a]: Number(e.target.value) })}
              />
            </FormField>
          ))}
        </div>
      ) : null}
      {options && !(kind === 'asiOrFeat') ? (
        <ul className="grid gap-1 sm:grid-cols-2">
          {options.map((o) => (
            <li key={o.id}>
              <label
                className={`flex items-center gap-2 text-sm ${o.disabledReason ? 'text-muted-foreground' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={picked.includes(o.id) || pending.selected.includes(o.id)}
                  disabled={Boolean(o.disabledReason) || pending.selected.includes(o.id)}
                  onChange={() => toggle(o.id)}
                  data-testid={`option-${o.id}`}
                />
                {o.name}
                {o.disabledReason ? ` (${o.disabledReason})` : ''}
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {needsSearch ? (
        <div className="grid gap-2">
          <Input
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`Search ${contentKind ?? 'feats'}`}
          />
          <ul className="grid max-h-56 gap-1 overflow-auto sm:grid-cols-2">
            {(search.data?.items ?? [])
              .filter(
                (e) =>
                  (filter.level === undefined || e.spell?.level === filter.level) &&
                  (filter.maxLevel === undefined || (e.spell?.level ?? 0) <= filter.maxLevel),
              )
              .map((e) => (
                <li key={e.uid}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.includes(e.uid) || pending.selected.includes(e.uid)}
                      disabled={pending.selected.includes(e.uid)}
                      onChange={() => (kind === 'asiOrFeat' ? setPicked([e.uid]) : toggle(e.uid))}
                    />
                    {e.name}
                    {e.spell ? ` (level ${e.spell.level})` : ''}
                  </label>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      {!options && !needsSearch && (kind === 'language' || kind === 'tool') ? (
        <Input
          placeholder={kind === 'language' ? 'e.g. elvish, dwarvish' : 'e.g. smiths-tools'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={pending.name}
        />
      ) : null}
      <div>
        <Button size="sm" onClick={save} data-testid={`save-${pending.key}`}>
          Save
        </Button>
      </div>
    </div>
  )
}
