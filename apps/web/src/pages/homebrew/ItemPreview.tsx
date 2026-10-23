import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { modifier, uidLabel } from '@/lib/characters'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'
import { newUuid } from '@/lib/uuid'
import { CREATURE_TYPES, selectClass } from '../character/shared'

/**
 * The item computed on one of the author's characters (the draft version when there is one):
 * action lines, the plan against an imagined target, granted spells and the stats it changes.
 * Nothing is written until "Give to" runs an `addItem` command.
 */
export function ItemPreview({
  entryId,
  uid,
  published,
  onError,
}: {
  entryId: string
  uid: string
  published: boolean
  onError: (message: string | null) => void
}) {
  const characters = useQuery(trpc.characters.list.queryOptions())
  const [characterId, setCharacterId] = useState('')
  const [targetType, setTargetType] = useState('')
  const [given, setGiven] = useState<string | null>(null)
  const selected = characterId || characters.data?.[0]?.id || ''
  const preview = useQuery({
    ...trpc.homebrew.items.preview.queryOptions({
      entryId,
      characterId: selected,
      ...(targetType ? { targetType } : {}),
    }),
    enabled: Boolean(selected),
  })
  const give = useMutation({
    mutationFn: async () => {
      const current = await trpcClient.characters.get.query({ characterId: selected })
      return trpcClient.characters.command.mutate({
        characterId: selected,
        commandId: newUuid(),
        expectedRevision: current.revision,
        command: {
          type: 'addItem',
          itemUid: uid,
          equipped: true,
          itemId: `${uid.split(':').pop()}-${Date.now().toString(36)}`,
        },
      })
    },
    onSuccess: () => {
      setGiven(selected)
      onError(null)
    },
    onError: (e) => onError(errorMessage(e)),
  })
  const p = preview.data
  return (
    <Card data-testid="item-preview">
      <CardHeader>
        <CardTitle>Preview on a character</CardTitle>
        <CardDescription>
          Computed by the engine as if the item were equipped and attuned. The character is not
          changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="grid gap-1">
            Character
            <select
              className={selectClass}
              value={selected}
              onChange={(e) => setCharacterId(e.target.value)}
              data-testid="preview-character"
            >
              {characters.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            Imagined target
            <select
              className={selectClass}
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
              data-testid="preview-target"
            >
              <option value="">unknown type</option>
              {CREATURE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        {characters.data && characters.data.length === 0 ? (
          <p className="text-muted-foreground">
            You need a character to preview on. <Link to="/characters/new">Build one.</Link>
          </p>
        ) : null}
        {preview.isError ? <p className="text-destructive">{errorMessage(preview.error)}</p> : null}
        {p ? (
          <div className="grid gap-2" data-testid="preview-result">
            {p.templates.map((t) => (
              <p key={t.id}>
                <span className="font-medium">{t.name}</span>
                {t.attack ? ` ${modifier(t.attack.bonus)}` : ''}
                {t.damage.length ? `, ${t.damage.map((d) => d.text).join(' or ')}` : ''}
                {t.riders.length ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {t.riders.map((r) => r.text).join('; ')}
                  </span>
                ) : null}
              </p>
            ))}
            {p.plan ? (
              <p data-testid="preview-plan">
                Plan{targetType ? ` against a ${targetType}` : ''}:{' '}
                {p.plan.damage.map((d) => `${d.formula} ${d.damageType}`).join(' + ') ||
                  'no damage'}
                {p.plan.questions.length
                  ? ` · asks: ${p.plan.questions.map((q) => q.text).join('; ')}`
                  : ''}
              </p>
            ) : null}
            {p.granted.length ? (
              <p>
                Grants{' '}
                {p.granted
                  .map(
                    (g) =>
                      `${uidLabel(g.spellUid)}${g.chargeCost ? ` (${g.chargeCost} charge${g.chargeCost === 1 ? '' : 's'})` : g.uses ? ` (${g.uses.max}/${g.uses.recharge})` : g.atWill ? ' (at will)' : ''}`,
                  )
                  .join(', ')}
              </p>
            ) : null}
            {p.changes.length ? (
              <ul className="flex flex-wrap gap-2" data-testid="preview-changes">
                {p.changes.map((c) => (
                  <li key={c.path}>
                    <Badge variant="secondary">
                      {c.path}: {c.before} → {c.after}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
            {p.diagnostics.map((d, i) => (
              <p key={i} className="text-destructive">
                {d.code}: {d.message}
              </p>
            ))}
            {p.templates.length === 0 && p.changes.length === 0 && p.granted.length === 0 ? (
              <p className="text-muted-foreground">
                Nothing on the sheet changes yet: add a weapon block, bonuses or a granted spell.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={!published || !selected || give.isPending}
            onClick={() => give.mutate()}
            data-testid="give-item"
          >
            Give to {characters.data?.find((c) => c.id === selected)?.name ?? 'character'}
          </Button>
          {!published ? (
            <span className="text-xs text-muted-foreground">Publish first to give it out.</span>
          ) : null}
          {given ? (
            <Link
              to="/characters/$characterId"
              params={{ characterId: given }}
              className="text-sm underline underline-offset-4"
              data-testid="open-character"
            >
              Added. Open the sheet.
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
