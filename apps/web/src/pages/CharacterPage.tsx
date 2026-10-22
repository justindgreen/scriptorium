import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useState } from 'react'
import type { ChoiceSelection, ComputedSheet, PendingChoice } from '@scriptorium/rules-engine'
import { FormError, FormField } from '@/components/FormField'
import { ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  ABILITY_NAMES,
  modifier,
  uidLabel,
  useCharacter,
  useCommand,
  type AbilityKey,
  type CharacterView,
} from '@/lib/characters'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'

const ABILITIES = Object.keys(ABILITY_NAMES) as AbilityKey[]
const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

function num(sheet: ComputedSheet, path: string): number {
  const v = sheet.stats[path]?.value
  return typeof v === 'number' ? v : 0
}

export function CharacterPage() {
  const { characterId } = useParams({ strict: false }) as { characterId: string }
  const view = useCharacter(characterId)
  const command = useCommand(characterId)
  const [error, setError] = useState<string | null>(null)

  if (view.isPending) return <LoadingState rows={6} />
  if (view.isError || !view.data)
    return (
      <ErrorState
        title="Character unavailable"
        message={view.error ? errorMessage(view.error) : 'Not found.'}
      />
    )
  const data = view.data
  const { sheet, aggregate } = data

  const send = async (cmd: Parameters<typeof command.mutateAsync>[0]['command']) => {
    setError(null)
    try {
      await command.mutateAsync({ command: cmd, expectedRevision: data.revision })
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const classes = sheet.classes
    .map((c) => `${c.name}${c.subclassName ? ` (${c.subclassName})` : ''} ${c.level}`)
    .join(' / ')
  return (
    <div className="grid gap-6">
      <PageHeader
        title={aggregate.name}
        description={`${sheet.level > 0 ? `Level ${sheet.level} · ${classes}` : 'No class yet'}${aggregate.definition.speciesUid ? ` · ${uidLabel(aggregate.definition.speciesUid)}` : ''} · revision ${data.revision}`}
      />
      <FormError message={error} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="grid gap-6">
          <Vitals sheet={sheet} view={data} send={send} />
          <PendingChoices view={data} send={send} />
          <Inventory view={data} send={send} />
          {sheet.spellcasting ? <Spells view={data} send={send} /> : null}
        </div>
        <div className="grid gap-6 self-start">
          <LevelUp view={data} send={send} />
          <History characterId={characterId} revision={data.revision} onError={setError} />
          <Diagnostics sheet={sheet} />
        </div>
      </div>
    </div>
  )
}

type SendFn = (
  cmd: Parameters<ReturnType<typeof useCommand>['mutateAsync']>[0]['command'],
) => Promise<void>

function Vitals({
  sheet,
  view,
  send,
}: {
  sheet: ComputedSheet
  view: CharacterView
  send: SendFn
}) {
  const [amount, setAmount] = useState(5)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vitals</CardTitle>
        <CardDescription>
          Computed by the rules engine; every number has a breakdown.
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
            </div>
          ))}
        </dl>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-muted-foreground">Armor class</dt>
          <dd data-testid="stat-ac">{num(sheet, 'ac.total')}</dd>
          <dt className="text-muted-foreground">Hit points</dt>
          <dd data-testid="stat-hp">
            {sheet.hp.current} / {sheet.hp.max}
            {sheet.hp.temp ? ` (+${sheet.hp.temp} temp)` : ''}
          </dd>
          <dt className="text-muted-foreground">Proficiency</dt>
          <dd>{modifier(num(sheet, 'proficiencyBonus'))}</dd>
          <dt className="text-muted-foreground">Speed</dt>
          <dd>{num(sheet, 'speed.walk')} ft.</dd>
          <dt className="text-muted-foreground">Initiative</dt>
          <dd>{modifier(num(sheet, 'initiative.bonus'))}</dd>
          <dt className="text-muted-foreground">Hit dice</dt>
          <dd>
            {sheet.hitDice.map((h) => `${h.max - h.spent}/${h.max} ${h.die}`).join(', ') || '—'}
          </dd>
        </dl>
        <div className="flex flex-wrap items-end gap-2">
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
          <Button variant="outline" onClick={() => void send({ type: 'shortRest' })}>
            Short rest
          </Button>
          <Button variant="outline" onClick={() => void send({ type: 'longRest' })}>
            Long rest
          </Button>
          {sheet.resources.length > 0 ? (
            <span className="text-sm text-muted-foreground">
              {sheet.resources
                .map(
                  (r) =>
                    `${r.name} ${r.current}/${typeof r.max.value === 'number' ? r.max.value : 0}`,
                )
                .join(' · ')}
            </span>
          ) : null}
        </div>
        {view.sheet.actionTemplates.length > 0 ? (
          <ul className="grid gap-1 text-sm" data-testid="action-templates">
            {view.sheet.actionTemplates.map((t) => (
              <li key={t.id}>
                <span className="font-medium">{t.name}</span>
                {t.attack ? ` ${modifier(t.attack.bonus)}` : ''}
                {t.damage.length ? `, ${t.damage.map((d) => d.text).join(' or ')}` : ''}
                {t.healing ? `, heals ${t.healing}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PendingChoices({ view, send }: { view: CharacterView; send: SendFn }) {
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

function Inventory({ view, send }: { view: CharacterView; send: SendFn }) {
  const [query, setQuery] = useState('')
  const items = useQuery({
    ...trpc.content.entries.list.queryOptions({ kind: 'item', q: query || undefined, limit: 20 }),
    enabled: query.length >= 2,
  })
  return (
    <Card data-testid="inventory">
      <CardHeader>
        <CardTitle>Inventory</CardTitle>
        <CardDescription>
          Equipped items feed the sheet; attunement is limited to three.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {view.aggregate.inventory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing carried yet.</p>
        ) : null}
        <ul className="grid gap-2">
          {view.aggregate.inventory.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span>
                {i.customItem?.name ?? uidLabel(i.itemUid)}
                {i.quantity > 1 ? ` ×${i.quantity}` : ''}{' '}
                {i.equipped ? <Badge variant="secondary">equipped</Badge> : null}{' '}
                {i.attuned ? <Badge>attuned</Badge> : null}
              </span>
              <span className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void send({ type: i.equipped ? 'unequip' : 'equip', itemId: i.id })
                  }
                  data-testid={`equip-${i.id}`}
                >
                  {i.equipped ? 'Unequip' : 'Equip'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void send({ type: i.attuned ? 'unattune' : 'attune', itemId: i.id })
                  }
                >
                  {i.attuned ? 'Unattune' : 'Attune'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void send({ type: 'removeItem', itemId: i.id })}
                >
                  Remove
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <Input
          placeholder="Add an item: search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search items"
          data-testid="item-search"
        />
        {items.data && query.length >= 2 ? (
          <ul className="grid max-h-48 gap-1 overflow-auto sm:grid-cols-2">
            {items.data.items.map((e) => (
              <li key={e.uid}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto w-full justify-start py-1 text-left"
                  onClick={() =>
                    void send({
                      type: 'addItem',
                      itemUid: e.uid,
                      equipped: true,
                      itemId: `${e.uid.split(':').pop()}-${Date.now().toString(36)}`,
                    })
                  }
                  data-testid={`add-${e.uid}`}
                >
                  {e.name}
                  {e.item?.magic ? ' ✦' : ''}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Spells({ view, send }: { view: CharacterView; send: SendFn }) {
  const casting = view.sheet.spellcasting!
  const [query, setQuery] = useState('')
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
              {view.aggregate.definition.spells.some((s) => s.spellUid === k.spellUid) ? (
                <Button size="sm" variant="ghost" onClick={() => void remove(k.spellUid)}>
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
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

function LevelUp({ view, send }: { view: CharacterView; send: SendFn }) {
  const classes = useQuery(trpc.content.entries.list.queryOptions({ kind: 'class', limit: 100 }))
  const [classUid, setClassUid] = useState(view.sheet.classes[0]?.classUid ?? '')
  const [roll, setRoll] = useState('')
  const [subclassFor, setSubclassFor] = useState(
    view.sheet.classes.find((c) => !c.subclassUid)?.classUid ?? '',
  )
  const subclasses = useQuery({
    ...trpc.content.entries.list.queryOptions({
      kind: 'subclass',
      tags: subclassFor ? [subclassFor.split(':').pop()!] : [],
      limit: 50,
    }),
    enabled: Boolean(subclassFor),
  })
  const [subclassUid, setSubclassUid] = useState('')
  const rolled = view.aggregate.definition.hpMode === 'rolled'
  return (
    <Card data-testid="level-up">
      <CardHeader>
        <CardTitle>Level up</CardTitle>
        <CardDescription>
          Level {view.sheet.level}. Multiclass prerequisites are checked by the engine.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <FormField id="levelup-class" label="Class">
          <select
            id="levelup-class"
            className={selectClass}
            value={classUid}
            onChange={(e) => setClassUid(e.target.value)}
            data-testid="levelup-class"
          >
            <option value="">Choose a class</option>
            {classes.data?.items.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        {rolled ? (
          <FormField id="levelup-roll" label="Hit die roll" hint="Leave empty to take the average.">
            <Input
              id="levelup-roll"
              type="number"
              min={1}
              max={12}
              value={roll}
              onChange={(e) => setRoll(e.target.value)}
              aria-describedby="levelup-roll-hint"
            />
          </FormField>
        ) : null}
        <Button
          disabled={!classUid}
          onClick={() =>
            void send({
              type: 'addClassLevel',
              classUid,
              ...(rolled && roll ? { hitDieRoll: Number(roll) } : {}),
            })
          }
          data-testid="levelup-add"
        >
          Add a level
        </Button>
        {view.sheet.classes.some((c) => !c.subclassUid) ? (
          <div className="grid gap-2 border-t pt-3">
            <FormField id="subclass-class" label="Subclass for">
              <select
                id="subclass-class"
                className={selectClass}
                value={subclassFor}
                onChange={(e) => setSubclassFor(e.target.value)}
              >
                {view.sheet.classes
                  .filter((c) => !c.subclassUid)
                  .map((c) => (
                    <option key={c.classUid} value={c.classUid}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField id="subclass" label="Subclass">
              <select
                id="subclass"
                className={selectClass}
                value={subclassUid}
                onChange={(e) => setSubclassUid(e.target.value)}
                data-testid="subclass-select"
              >
                <option value="">Choose</option>
                {subclasses.data?.items.map((s) => (
                  <option key={s.uid} value={s.uid}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
            <Button
              variant="outline"
              disabled={!subclassUid}
              onClick={() => void send({ type: 'setSubclass', classUid: subclassFor, subclassUid })}
              data-testid="subclass-set"
            >
              Set subclass
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function History({
  characterId,
  revision,
  onError,
}: {
  characterId: string
  revision: number
  onError: (m: string | null) => void
}) {
  const queryClient = useQueryClient()
  const events = useQuery(trpc.characters.events.queryOptions({ characterId, limit: 20 }))
  const undoable = useQuery(trpc.characters.undoAvailability.queryOptions({ characterId }))
  const snapshots = useQuery(trpc.characters.snapshots.list.queryOptions({ characterId }))
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.characters.pathKey() })
  const undo = useMutation({
    mutationFn: () =>
      trpcClient.characters.undo.mutate({ characterId, expectedRevision: revision }),
    onSuccess: refresh,
    onError: (e) => onError(errorMessage(e)),
  })
  const restore = useMutation({
    mutationFn: (snapshotId: string) =>
      trpcClient.characters.snapshots.restore.mutate({
        characterId,
        snapshotId,
        expectedRevision: revision,
      }),
    onSuccess: refresh,
    onError: (e) => onError(errorMessage(e)),
  })
  return (
    <Card data-testid="history">
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>
          Undo covers the latest reversible change; snapshots cover the rest.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Button
          variant="outline"
          disabled={!undoable.data?.ok || undo.isPending}
          onClick={() => undo.mutate()}
          data-testid="undo"
        >
          {undoable.data?.ok
            ? `Undo ${undoable.data.eventType}`
            : `Undo unavailable${undoable.data && !undoable.data.ok ? `: ${undoable.data.reason}` : ''}`}
        </Button>
        <ol className="grid gap-1 text-sm" data-testid="event-log">
          {events.data?.map((e) => (
            <li key={e.id} className="flex justify-between gap-2">
              <span>{e.summary || e.type}</span>
              <span className="tabular text-muted-foreground">r{e.revisionAfter}</span>
            </li>
          ))}
        </ol>
        {snapshots.data && snapshots.data.length > 0 ? (
          <ul className="grid gap-1 border-t pt-3 text-sm">
            {snapshots.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span>
                  {s.reason.replace('_', ' ')} · r{s.revision}
                </span>
                <Button size="sm" variant="ghost" onClick={() => restore.mutate(s.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Diagnostics({ sheet }: { sheet: ComputedSheet }) {
  const shown = sheet.diagnostics.filter((d) => d.severity !== 'info')
  if (shown.length === 0) return null
  return (
    <Card data-testid="diagnostics">
      <CardHeader>
        <CardTitle>Diagnostics</CardTitle>
        <CardDescription>{shown.length} the engine wants you to know about.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1 text-sm">
          {shown.map((d, i) => (
            <li key={`${d.code}-${i}`}>
              <Badge variant={d.severity === 'error' ? 'destructive' : 'secondary'}>{d.code}</Badge>{' '}
              {d.message}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
