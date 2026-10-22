import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { useSubscription } from '@trpc/tanstack-react-query'
import { useState } from 'react'
import { FormError } from '@/components/FormField'
import { ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { uidLabel } from '@/lib/characters'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'
import { selectClass } from './character/shared'

type Encounter = Awaited<ReturnType<typeof trpcClient.encounters.get.query>>
type AttackAction = Encounter['actions'][string][number]['action']
type Rolled = Awaited<ReturnType<typeof trpcClient.encounters.attackRoll.mutate>>
type Committed = Awaited<ReturnType<typeof trpcClient.encounters.commitAttack.mutate>>

const POLL_MS = 15_000

/**
 * The combat tracker (M2.8 thin slice). The DM adds the party and monsters, rolls or sets
 * initiative, runs rounds and turns, and resolves attacks through the coordinator; players see
 * the order, conditions and the log, never monster hit points.
 */
export function EncounterPage() {
  const { encounterId } = useParams({ strict: false }) as { encounterId: string }
  const queryClient = useQueryClient()
  const [live, setLive] = useState(false)
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.encounters.get.queryKey({ encounterId }) }),
      queryClient.invalidateQueries({ queryKey: trpc.characters.pathKey() }),
    ])
  useSubscription(
    trpc.encounters.subscribe.subscriptionOptions(
      { encounterId },
      {
        onData: (event) => {
          if (event.type !== 'ready' && event.type !== 'encounter.changed') return
          const cached = queryClient.getQueryData(trpc.encounters.get.queryKey({ encounterId }))
          if (!cached || cached.version !== event.version) void invalidate()
        },
        onConnectionStateChange: (state) => setLive(state.state === 'pending'),
      },
    ),
  )
  const encounter = useQuery({
    ...trpc.encounters.get.queryOptions({ encounterId }),
    refetchInterval: live ? false : POLL_MS,
  })
  const [error, setError] = useState<string | null>(null)

  if (encounter.isPending) return <LoadingState rows={6} />
  if (encounter.isError || !encounter.data)
    return (
      <ErrorState
        title="Encounter unavailable"
        message={encounter.error ? errorMessage(encounter.error) : 'Not found.'}
      />
    )
  const e = encounter.data
  const dm = e.role === 'dm'
  return (
    <div className="grid gap-6">
      <PageHeader
        title={e.name}
        description={`${e.status}${e.status === 'active' ? ` · round ${e.round}, turn ${e.turnIndex + 1}` : ''} · version ${e.version}`}
        actions={
          <>
            <Badge variant={live ? 'secondary' : 'outline'} data-testid="live-status">
              {live ? 'Live' : 'Polling'}
            </Badge>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/campaigns/$campaignId" params={{ campaignId: e.campaignId }}>
                Campaign
              </Link>
            </Button>
          </>
        }
      />
      <FormError message={error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid min-w-0 gap-6">
          <Participants encounter={e} onError={setError} onChanged={invalidate} />
          {dm ? <AttackPanel encounter={e} onError={setError} onChanged={invalidate} /> : null}
        </div>
        <div className="grid min-w-0 gap-6 self-start">
          {dm ? <DmControls encounter={e} onError={setError} onChanged={invalidate} /> : null}
          <Card data-testid="encounter-log">
            <CardHeader>
              <CardTitle>Log</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-1 text-sm">
                {e.events.map((ev) => (
                  <li key={ev.id} className="flex justify-between gap-2">
                    <span>{describeEvent(ev.type, ev.payload)}</span>
                    <span className="tabular text-muted-foreground">v{ev.versionAfter}</span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function describeEvent(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'attack':
      return String(payload['summary'] ?? 'Attack')
    case 'started':
      return `Combat started (round ${String(payload['round'])})`
    case 'turnStarted':
      return `Round ${String(payload['round'])}, turn ${Number(payload['turnIndex']) + 1}`
    case 'initiativeRolled':
      return 'Initiative rolled'
    case 'initiativeSet':
      return `Initiative set to ${String(payload['initiative'])}`
    case 'participantAdded':
      return `Added ${String(payload['name'] ?? uidLabel(String(payload['uid'] ?? '')))}`
    case 'condition':
      return `${payload['active'] ? 'Applied' : 'Removed'} ${uidLabel(String(payload['uid']))}`
    case 'hpAdjusted':
      return `Hit points adjusted by ${String(payload['delta'])}`
    case 'ended':
      return 'Combat ended'
    default:
      return type
  }
}

function Participants({
  encounter: e,
  onError,
  onChanged,
}: {
  encounter: Encounter
  onError: (m: string | null) => void
  onChanged: () => Promise<unknown>
}) {
  const dm = e.role === 'dm'
  const conditions = useQuery({
    ...trpc.content.entries.list.queryOptions({ kind: 'condition', limit: 50 }),
    enabled: dm,
  })
  const setInitiative = useMutation({
    mutationFn: (input: { participantId: string; initiative: number }) =>
      trpcClient.encounters.setInitiative.mutate({ encounterId: e.id, ...input }),
    onSuccess: () => void onChanged(),
    onError: (err) => onError(errorMessage(err)),
  })
  const adjustHp = useMutation({
    mutationFn: (input: { participantId: string; delta: number }) =>
      trpcClient.encounters.adjustHp.mutate({ encounterId: e.id, ...input }),
    onSuccess: () => void onChanged(),
    onError: (err) => onError(errorMessage(err)),
  })
  const setCondition = useMutation({
    mutationFn: (input: { participantId: string; uid: string; active: boolean }) =>
      trpcClient.encounters.setCondition.mutate({ encounterId: e.id, ...input }),
    onSuccess: () => void onChanged(),
    onError: (err) => onError(errorMessage(err)),
  })
  return (
    <Card data-testid="participants">
      <CardHeader>
        <CardTitle>Initiative order</CardTitle>
        <CardDescription>
          {e.status === 'planned'
            ? 'Add everyone, roll or set initiative, then start.'
            : e.status === 'active'
              ? 'The marked participant acts now.'
              : 'Combat is over.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {e.participants.map((p) => (
            <li
              key={p.id}
              className={`grid gap-2 rounded-md border p-2 text-sm ${p.id === e.currentParticipantId ? 'border-primary bg-accent/40' : ''} ${p.defeated ? 'opacity-60' : ''}`}
              data-testid={`participant-${p.id}`}
              aria-current={p.id === e.currentParticipantId ? 'true' : undefined}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {p.id === e.currentParticipantId ? <span aria-hidden="true">▶ </span> : null}
                  <span className="font-medium">{p.displayName}</span>
                  {p.kind === 'character' && p.characterId ? (
                    <Link
                      to="/characters/$characterId"
                      params={{ characterId: p.characterId }}
                      className="ml-2 text-xs underline underline-offset-4"
                    >
                      sheet
                    </Link>
                  ) : null}{' '}
                  {p.defeated ? <Badge variant="destructive">defeated</Badge> : null}
                  {p.conditions.map((c) => (
                    <Badge key={c.uid} variant="outline" className="ml-1">
                      {uidLabel(c.uid)}
                    </Badge>
                  ))}
                </span>
                <span className="flex flex-wrap items-center gap-2 tabular">
                  <span className="text-muted-foreground">init</span>
                  {dm && e.status === 'planned' ? (
                    <Input
                      type="number"
                      className="w-16"
                      defaultValue={p.initiative ?? ''}
                      aria-label={`${p.displayName} initiative`}
                      onBlur={(ev) => {
                        const value = Number(ev.target.value)
                        if (ev.target.value !== '' && value !== p.initiative)
                          setInitiative.mutate({ participantId: p.id, initiative: value })
                      }}
                      data-testid={`initiative-${p.id}`}
                    />
                  ) : (
                    <span data-testid={`initiative-${p.id}`}>{p.initiative ?? '—'}</span>
                  )}
                  {p.kind === 'monster' && p.hpCurrent !== null ? (
                    <span data-testid={`hp-${p.id}`}>
                      HP {p.hpCurrent}/{p.hpMax}
                    </span>
                  ) : null}
                  {p.ac !== null ? <span className="text-muted-foreground">AC {p.ac}</span> : null}
                </span>
              </div>
              {dm ? (
                <div className="flex flex-wrap items-center gap-1 print:hidden">
                  {p.kind === 'monster' ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => adjustHp.mutate({ participantId: p.id, delta: -1 })}
                        aria-label={`${p.displayName} loses 1 hit point`}
                      >
                        −1
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => adjustHp.mutate({ participantId: p.id, delta: 1 })}
                        aria-label={`${p.displayName} regains 1 hit point`}
                      >
                        +1
                      </Button>
                    </>
                  ) : null}
                  <select
                    className={`${selectClass} w-auto`}
                    value=""
                    onChange={(ev) => {
                      if (ev.target.value)
                        setCondition.mutate({
                          participantId: p.id,
                          uid: ev.target.value,
                          active: true,
                        })
                    }}
                    aria-label={`Add a condition to ${p.displayName}`}
                    data-testid={`condition-add-${p.id}`}
                  >
                    <option value="">+ condition</option>
                    {(conditions.data?.items ?? [])
                      .filter((c) => !p.conditions.some((pc) => pc.uid === c.uid))
                      .map((c) => (
                        <option key={c.uid} value={c.uid}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                  {p.conditions.map((c) => (
                    <Button
                      key={c.uid}
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setCondition.mutate({ participantId: p.id, uid: c.uid, active: false })
                      }
                    >
                      remove {uidLabel(c.uid)}
                    </Button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function DmControls({
  encounter: e,
  onError,
  onChanged,
}: {
  encounter: Encounter
  onError: (m: string | null) => void
  onChanged: () => Promise<unknown>
}) {
  const campaign = useQuery(trpc.campaigns.get.queryOptions({ campaignId: e.campaignId }))
  const [characterId, setCharacterId] = useState('')
  const [monsterQuery, setMonsterQuery] = useState('')
  const monsters = useQuery({
    ...trpc.content.entries.list.queryOptions({
      kind: 'monster',
      q: monsterQuery,
      tags: ['alpha'],
      limit: 12,
    }),
    enabled: monsterQuery.length >= 2,
  })
  const run = <T,>(fn: () => Promise<T>) =>
    fn()
      .then(() => {
        onError(null)
        return onChanged()
      })
      .catch((err) => onError(errorMessage(err)))
  const inEncounter = new Set(e.participants.map((p) => p.characterId).filter(Boolean))
  const party = (campaign.data?.characters ?? []).filter(
    (c) => c.status === 'approved' && !inEncounter.has(c.characterId),
  )
  return (
    <Card data-testid="dm-controls">
      <CardHeader>
        <CardTitle>Run the encounter</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {e.status === 'planned' ? (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid min-w-0 flex-1 gap-1">
                Add a party character
                <select
                  className={selectClass}
                  value={characterId}
                  onChange={(ev) => setCharacterId(ev.target.value)}
                  data-testid="add-character-select"
                >
                  <option value="">Choose</option>
                  {party.map((c) => (
                    <option key={c.characterId} value={c.characterId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                disabled={!characterId}
                onClick={() =>
                  void run(() =>
                    trpcClient.encounters.addCharacter.mutate({ encounterId: e.id, characterId }),
                  ).then(() => setCharacterId(''))
                }
                data-testid="add-character"
              >
                Add
              </Button>
            </div>
            <div className="grid gap-1">
              <Input
                value={monsterQuery}
                onChange={(ev) => setMonsterQuery(ev.target.value)}
                placeholder="Add a monster: search, e.g. skeleton"
                aria-label="Search monsters"
                data-testid="monster-search"
              />
              {monsters.data && monsterQuery.length >= 2 ? (
                <ul className="flex flex-wrap gap-1">
                  {monsters.data.items.map((m) => (
                    <li key={m.uid}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void run(() =>
                            trpcClient.encounters.addMonster.mutate({
                              encounterId: e.id,
                              uid: m.uid,
                            }),
                          )
                        }
                        data-testid={`add-monster-${m.uid}`}
                      >
                        {m.name}
                        {m.monster ? ` (CR ${m.monster.challengeRating})` : ''}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button
                variant="outline"
                onClick={() =>
                  void run(() => trpcClient.encounters.rollInitiative.mutate({ encounterId: e.id }))
                }
                data-testid="roll-initiative"
              >
                Roll initiative
              </Button>
              <Button
                disabled={
                  e.participants.length === 0 || e.participants.some((p) => p.initiative === null)
                }
                onClick={() =>
                  void run(() =>
                    trpcClient.encounters.start.mutate({
                      encounterId: e.id,
                      expectedVersion: e.version,
                    }),
                  )
                }
                data-testid="start-encounter"
              >
                Start combat
              </Button>
            </div>
          </>
        ) : null}
        {e.status === 'active' ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void run(() =>
                  trpcClient.encounters.nextTurn.mutate({
                    encounterId: e.id,
                    expectedVersion: e.version,
                  }),
                )
              }
              data-testid="next-turn"
            >
              Next turn
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                void run(() =>
                  trpcClient.encounters.end.mutate({
                    encounterId: e.id,
                    expectedVersion: e.version,
                  }),
                )
              }
              data-testid="end-encounter"
            >
              End combat
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function AttackPanel({
  encounter: e,
  onError,
  onChanged,
}: {
  encounter: Encounter
  onError: (m: string | null) => void
  onChanged: () => Promise<unknown>
}) {
  const [attackerId, setAttackerId] = useState('')
  const [actionIndex, setActionIndex] = useState(0)
  const [targetId, setTargetId] = useState('')
  const [advantage, setAdvantage] = useState<'normal' | 'advantage' | 'disadvantage'>('normal')
  const [rolled, setRolled] = useState<(Rolled & { commandId: string }) | null>(null)
  const [committed, setCommitted] = useState<Committed | null>(null)
  const attacker = attackerId || e.currentParticipantId || e.participants[0]?.id || ''
  const options = e.actions[attacker] ?? []
  const action: AttackAction | undefined = options[actionIndex]?.action ?? options[0]?.action
  const target = targetId || e.participants.find((p) => p.id !== attacker && !p.defeated)?.id || ''
  const input = action
    ? { encounterId: e.id, attackerId: attacker, targetId: target, action, advantage }
    : null
  const plan = useQuery({
    ...trpc.encounters.attackPlan.queryOptions(
      input ?? {
        encounterId: e.id,
        attackerId: attacker,
        targetId: target,
        action: { kind: 'unarmed' },
        advantage,
      },
    ),
    enabled: Boolean(input && attacker && target && e.status === 'active'),
  })
  const roll = useMutation({
    mutationFn: () => trpcClient.encounters.attackRoll.mutate(input!),
    onSuccess: (result) => {
      onError(null)
      setCommitted(null)
      // One command id per roll: a retry after a failure re-sends the same id and applies once.
      setRolled({ ...result, commandId: crypto.randomUUID() })
    },
    onError: (err) => onError(errorMessage(err)),
  })
  const commit = useMutation({
    mutationFn: () =>
      trpcClient.encounters.commitAttack.mutate({
        encounterId: e.id,
        commandId: rolled!.commandId,
        rollId: rolled!.rollId,
        expectedVersion: e.version,
      }),
    onSuccess: async (result) => {
      onError(null)
      setCommitted(result)
      setRolled(null)
      await onChanged()
    },
    onError: (err) => onError(errorMessage(err)),
  })
  const p = plan.data
  const summary =
    p && p.kind === 'character'
      ? `${p.plan.name}: ${p.plan.attack ? `${p.plan.attack.bonus >= 0 ? '+' : ''}${p.plan.attack.bonus} to hit (${p.plan.attack.mode})` : 'no attack roll'}${p.plan.damage.length ? `, ${p.plan.damage.map((d) => `${d.formula} ${d.damageType}`).join(' + ')}` : ''}${p.targetAc !== null ? ` vs AC ${p.targetAc}` : ''}${p.plan.blocked ? ` · blocked: ${p.plan.blocked}` : ''}`
      : p
        ? `${p.name}: +${p.attackBonus} to hit (${p.mode}), ${p.damage.map((d) => `${d.formula} ${d.damageType}`).join(' + ')}${p.targetAc !== null ? ` vs AC ${p.targetAc}` : ''}`
        : ''
  return (
    <Card data-testid="attack-panel">
      <CardHeader>
        <CardTitle>Attack</CardTitle>
        <CardDescription>
          Plan, roll on the server, apply. A retried apply with the same command id applies once.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {e.status !== 'active' ? (
          <p className="text-muted-foreground">Start combat to resolve attacks.</p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1">
                Attacker
                <select
                  className={selectClass}
                  value={attacker}
                  onChange={(ev) => {
                    setAttackerId(ev.target.value)
                    setActionIndex(0)
                    setRolled(null)
                  }}
                  data-testid="attacker-select"
                >
                  {e.participants.map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                Action
                <select
                  className={selectClass}
                  value={actionIndex}
                  onChange={(ev) => {
                    setActionIndex(Number(ev.target.value))
                    setRolled(null)
                  }}
                  data-testid="action-select"
                >
                  {options.map((o, i) => (
                    <option key={i} value={i}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                Target
                <select
                  className={selectClass}
                  value={target}
                  onChange={(ev) => {
                    setTargetId(ev.target.value)
                    setRolled(null)
                  }}
                  data-testid="target-select"
                >
                  {e.participants
                    .filter((pt) => pt.id !== attacker)
                    .map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <label className="grid gap-1">
                Advantage
                <select
                  className={selectClass}
                  value={advantage}
                  onChange={(ev) => {
                    setAdvantage(ev.target.value as typeof advantage)
                    setRolled(null)
                  }}
                >
                  <option value="normal">normal</option>
                  <option value="advantage">advantage</option>
                  <option value="disadvantage">disadvantage</option>
                </select>
              </label>
            </div>
            {options.length === 0 ? (
              <p className="text-muted-foreground">This participant has no attack.</p>
            ) : null}
            {summary ? <p data-testid="attack-plan">{summary}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={
                  !input || roll.isPending || (p?.kind === 'character' && Boolean(p.plan.blocked))
                }
                onClick={() => roll.mutate()}
                data-testid="attack-roll"
              >
                {rolled ? 'Roll again' : 'Roll'}
              </Button>
              {rolled ? (
                <Button
                  variant="outline"
                  disabled={commit.isPending}
                  onClick={() => commit.mutate()}
                  data-testid="attack-apply"
                >
                  Apply
                </Button>
              ) : null}
            </div>
            {rolled ? (
              <p data-testid="attack-rolled">
                {rolled.results.attack
                  ? `Attack roll ${rolled.results.attack.total} (d20 ${rolled.results.d20?.join(' | ')})`
                  : rolled.results.monster
                    ? `Attack roll ${rolled.results.monster.total} (d20 ${rolled.results.d20?.join(' | ')})${rolled.results.monster.critical ? ' critical' : ''}`
                    : ''}
                {rolled.results.damage
                  ? ` · damage ${Object.values(rolled.results.damage).join(' + ')}`
                  : rolled.results.monster
                    ? ` · damage ${Object.values(rolled.results.monster.damage).join(' + ')}`
                    : ''}
              </p>
            ) : null}
            {committed ? (
              <p data-testid="attack-result">
                {committed.summary}
                {committed.replayed ? ' (already applied)' : ''}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
