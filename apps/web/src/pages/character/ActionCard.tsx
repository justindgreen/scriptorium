import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ActionContext, ActionRef } from '@scriptorium/rules-engine'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { modifier, useInvalidateCharacter } from '@/lib/characters'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'
import { CREATURE_TYPES, SIZES, selectClass, type SendFn } from './shared'

/** The plan as the API serializes it (optional fields may be absent after JSON). */
type ActionPlan = Awaited<ReturnType<typeof trpcClient.characters.plan.query>>
type StoredRoll = Awaited<ReturnType<typeof trpcClient.characters.roll.mutate>>
type Committed = Awaited<ReturnType<typeof trpcClient.characters.commitAction.mutate>>

type Situation = {
  advantage: boolean
  disadvantage: boolean
  allyAdjacent: boolean | undefined
  hidden: boolean
  firstAttack: boolean | undefined
  targetType: string
  targetSize: string
  targetAc: string
}

const EMPTY: Situation = {
  advantage: false,
  disadvantage: false,
  allyAdjacent: undefined,
  hidden: false,
  firstAttack: undefined,
  targetType: '',
  targetSize: '',
  targetAc: '',
}

/**
 * One action from plan to roll to commit (docs/RULES_ENGINE.md §6). The plan is recomputed on the
 * server whenever the situation changes; "Roll" rolls there with the cryptographic RNG; "Apply"
 * consumes that roll exactly once through `applyActionOutcome`.
 */
export function ActionCard({
  characterId,
  revision,
  actionRef,
  title,
  summary,
  send,
  onError,
  testId,
}: {
  characterId: string
  revision: number
  actionRef: ActionRef
  title: string
  summary?: string
  send: SendFn
  onError: (message: string | null) => void
  testId: string
}) {
  const [open, setOpen] = useState(false)
  const [situation, setSituation] = useState<Situation>(EMPTY)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [declined, setDeclined] = useState<string[]>([])
  const [rolled, setRolled] = useState<StoredRoll | null>(null)
  const [applied, setApplied] = useState<Committed | null>(null)
  const invalidate = useInvalidateCharacter(characterId)
  const rollOnly = actionRef.kind === 'check' || actionRef.kind === 'save'

  const ctx: ActionContext = {
    situation: {
      advantageSources: situation.advantage ? ['player'] : [],
      disadvantageSources: situation.disadvantage ? ['player'] : [],
      hidden: situation.hidden,
      ...(situation.allyAdjacent !== undefined
        ? { allyAdjacentToTarget: situation.allyAdjacent }
        : {}),
      ...(situation.firstAttack !== undefined
        ? { firstAttackThisTurn: situation.firstAttack }
        : {}),
    },
    target: {
      ...(situation.targetType ? { creatureType: situation.targetType } : {}),
      ...(situation.targetSize ? { size: situation.targetSize } : {}),
      ...(situation.targetAc ? { ac: Number(situation.targetAc) } : {}),
    },
    options: { answers, declineOptional: declined },
  }

  const plan = useQuery({
    ...trpc.characters.plan.queryOptions({ characterId, ref: actionRef, ctx }),
    enabled: open,
  })
  const roll = useMutation({
    mutationFn: () => trpcClient.characters.roll.mutate({ characterId, ref: actionRef, ctx }),
    onSuccess: (result) => {
      setRolled(result)
      setApplied(null)
      onError(null)
    },
    onError: (e) => onError(errorMessage(e)),
  })
  const commit = useMutation({
    mutationFn: (rollId: string) =>
      trpcClient.characters.commitAction.mutate({
        characterId,
        commandId: crypto.randomUUID(),
        expectedRevision: revision,
        rollId,
        ...(situation.targetAc ? { targetAc: Number(situation.targetAc) } : {}),
      }),
    onSuccess: async (result) => {
      setApplied(result)
      setRolled(null)
      onError(null)
      await invalidate()
    },
    onError: (e) => onError(errorMessage(e)),
  })

  const update = (patch: Partial<Situation>) => {
    setSituation((s) => ({ ...s, ...patch }))
    setRolled(null)
  }
  const p = plan.data

  return (
    <div className="rounded-md border" data-testid={testId}>
      <button
        type="button"
        className="flex w-full flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid={`${testId}-toggle`}
      >
        <span className="font-medium">{title}</span>
        {summary ? <span className="text-muted-foreground">{summary}</span> : null}
      </button>
      {open ? (
        <div className="grid gap-3 border-t px-3 py-3 text-sm print:hidden">
          {plan.isPending ? <p className="text-muted-foreground">Planning…</p> : null}
          {plan.isError ? <p className="text-destructive">{errorMessage(plan.error)}</p> : null}
          {p ? (
            <>
              <PlanView plan={p} declined={declined} setDeclined={setDeclined} />
              <Prompts
                plan={p}
                answers={answers}
                setAnswers={(next) => {
                  setAnswers(next)
                  setRolled(null)
                }}
                send={send}
              />
              {!rollOnly ? <SituationForm situation={situation} update={update} /> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={Boolean(p.blocked) || roll.isPending}
                  onClick={() => roll.mutate()}
                  data-testid={`${testId}-roll`}
                >
                  {rolled ? 'Roll again' : 'Roll'}
                </Button>
                {rolled && !rollOnly ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={commit.isPending}
                    onClick={() => commit.mutate(rolled.id)}
                    data-testid={`${testId}-apply`}
                  >
                    Apply to sheet
                  </Button>
                ) : null}
                {p.blocked ? <span className="text-destructive">Blocked: {p.blocked}</span> : null}
              </div>
              {rolled ? <RollView roll={rolled} targetAc={situation.targetAc} /> : null}
              {applied ? <AppliedView result={applied} /> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PlanView({
  plan,
  declined,
  setDeclined,
}: {
  plan: ActionPlan
  declined: string[]
  setDeclined: (ids: string[]) => void
}) {
  return (
    <div className="grid gap-1">
      {plan.attack ? (
        <p>
          <span className="font-medium">Attack</span> {modifier(plan.attack.bonus)}
          {plan.attack.mode !== 'normal' ? (
            <Badge variant="secondary">{plan.attack.mode}</Badge>
          ) : null}
          {plan.attack.critRange < 20 ? ` · crit on ${plan.attack.critRange}+` : ''}
          <span className="text-muted-foreground">
            {' '}
            (
            {plan.attack.breakdown
              .filter((l) => l.applied)
              .map(
                (l) =>
                  `${l.source.name} ${typeof l.value === 'number' ? modifier(l.value) : String(l.value)}`,
              )
              .join(', ')}
            )
          </span>
        </p>
      ) : null}
      {plan.check ? (
        <p>
          <span className="font-medium">{plan.check.label}</span> {modifier(plan.check.bonus)}
          {plan.check.mode !== 'normal' ? (
            <Badge variant="secondary">{plan.check.mode}</Badge>
          ) : null}
        </p>
      ) : null}
      {plan.save ? (
        <p>
          <span className="font-medium">Save</span> {plan.save.ability.toUpperCase()} DC{' '}
          {plan.save.dc}
          {plan.save.onSuccess !== 'none' ? ` (${plan.save.onSuccess} on a success)` : ''}
        </p>
      ) : null}
      {plan.damage.length > 0 ? (
        <ul className="grid gap-0.5">
          {plan.damage.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <span>
                <span className="font-medium">{d.label}</span> {d.formula} {d.damageType}
                {d.flags.magical ? ' (magical)' : ''}
              </span>
              {d.optional ? (
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={!declined.includes(d.id)}
                    onChange={(e) =>
                      setDeclined(
                        e.target.checked ? declined.filter((x) => x !== d.id) : [...declined, d.id],
                      )
                    }
                  />
                  use
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.excluded.map((x) => (
        <p key={x.id} className="text-xs text-muted-foreground">
          {x.label}: {x.reason}
        </p>
      ))}
      {plan.healing ? <p>Heals {plan.healing}</p> : null}
      {plan.costs.length > 0 ? (
        <p className={plan.costs.every((c) => c.sufficient) ? '' : 'text-destructive'}>
          Costs:{' '}
          {plan.costs
            .map(
              (c) =>
                `${c.amount} ${c.kind === 'slot' ? `level ${c.level} slot` : (c.id ?? c.kind)} (${c.available} available)`,
            )
            .join(', ')}
        </p>
      ) : null}
      {!plan.economy.available ? (
        <p className="text-xs text-muted-foreground">
          {plan.economy.kind}{' '}
          {plan.economy.reason ? `· ${plan.economy.reason}` : 'already used this turn'}
        </p>
      ) : null}
      {plan.riders.map((r, i) => (
        <p key={i} className="text-xs text-muted-foreground">
          {r.when === 'always' ? '' : `On ${r.when}: `}
          {r.text} ({r.source.name})
        </p>
      ))}
      {plan.assumptions.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Assuming: {plan.assumptions.map((a) => a.text).join('; ')}
        </p>
      ) : null}
    </div>
  )
}

function Prompts({
  plan,
  answers,
  setAnswers,
  send,
}: {
  plan: ActionPlan
  answers: Record<string, unknown>
  setAnswers: (next: Record<string, unknown>) => void
  send: SendFn
}) {
  if (plan.questions.length === 0) return null
  return (
    <div className="grid gap-2 rounded-md bg-muted/40 p-2">
      {plan.questions.map((q) => {
        const value = answers[q.id] ?? q.assumed
        const control =
          q.kind === 'boolean' ? (
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.checked })}
            />
          ) : q.kind === 'creatureType' || q.kind === 'size' ? (
            <select
              className={`${selectClass} w-auto`}
              value={String(value ?? '')}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              aria-label={q.text}
            >
              <option value="">unknown</option>
              {(q.kind === 'size' ? SIZES : CREATURE_TYPES).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <Input
              className="w-40"
              value={String(value ?? '')}
              onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
              aria-label={q.text}
            />
          )
        return (
          <div key={q.id} className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-2">
              {control}
              {q.text}
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => void send({ type: 'setAssumption', id: q.id, value })}
              title="Use this answer by default for this character"
            >
              Remember
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function SituationForm({
  situation,
  update,
}: {
  situation: Situation
  update: (patch: Partial<Situation>) => void
}) {
  return (
    <details>
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Situation and target
      </summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={situation.advantage}
            onChange={(e) => update({ advantage: e.target.checked })}
          />
          Advantage
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={situation.disadvantage}
            onChange={(e) => update({ disadvantage: e.target.checked })}
          />
          Disadvantage
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={situation.allyAdjacent === true}
            onChange={(e) => update({ allyAdjacent: e.target.checked ? true : undefined })}
          />
          An ally is within 5 feet of the target
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={situation.hidden}
            onChange={(e) => update({ hidden: e.target.checked })}
          />
          I am hidden
        </label>
        <label className="grid gap-1 text-xs">
          Target type
          <select
            className={selectClass}
            value={situation.targetType}
            onChange={(e) => update({ targetType: e.target.value })}
          >
            <option value="">unknown</option>
            {CREATURE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs" htmlFor="target-ac">
          Target AC (optional)
          <Input
            id="target-ac"
            type="number"
            min={0}
            max={40}
            value={situation.targetAc}
            onChange={(e) => update({ targetAc: e.target.value })}
            data-testid="target-ac"
          />
        </label>
      </div>
    </details>
  )
}

function RollView({ roll, targetAc }: { roll: StoredRoll; targetAc: string }) {
  const r = roll.results
  const attack = r.attack
  const crit = attack ? attack.natural >= roll.plan.attack!.critRange : false
  const hit =
    attack && targetAc
      ? attack.natural !== 1 && (crit || (attack.total ?? attack.natural) >= Number(targetAc))
      : null
  return (
    <div className="grid gap-1 rounded-md border p-2" data-testid="roll-result">
      {attack ? (
        <p>
          <span className="font-medium">Attack roll</span> {attack.total ?? attack.natural}{' '}
          <span className="text-muted-foreground">
            (d20 {r.d20?.join(' | ') ?? attack.natural} {modifier(roll.plan.attack!.bonus)})
          </span>{' '}
          {crit ? (
            <Badge>critical</Badge>
          ) : attack.natural === 1 ? (
            <Badge variant="destructive">natural 1</Badge>
          ) : null}{' '}
          {hit === null ? null : hit ? (
            <Badge variant="secondary">hits AC {targetAc}</Badge>
          ) : (
            <Badge variant="outline">misses AC {targetAc}</Badge>
          )}
        </p>
      ) : null}
      {r.check ? (
        <p>
          <span className="font-medium">Result</span> {r.check.total}{' '}
          <span className="text-muted-foreground">
            (d20 {r.d20?.join(' | ') ?? r.check.natural})
          </span>
        </p>
      ) : null}
      {r.damage
        ? roll.plan.damage.map((d) => (
            <p key={d.id}>
              <span className="font-medium">{d.label}</span> {r.damage![d.id]} {d.damageType}{' '}
              <span className="text-muted-foreground">({r.damageDetails?.[d.id]})</span>
            </p>
          ))
        : null}
      {r.healing !== undefined ? (
        <p>
          <span className="font-medium">Healing</span> {r.healing}{' '}
          <span className="text-muted-foreground">({r.damageDetails?.['healing']})</span>
        </p>
      ) : null}
    </div>
  )
}

function AppliedView({ result }: { result: Committed }) {
  const o = result.outcome
  const total = o.packets.reduce((n, p) => n + p.amount, 0)
  const verdict = o.attack
    ? o.attack.hit === null
      ? 'rolled'
      : o.attack.hit
        ? 'hit'
        : 'missed'
    : 'applied'
  return (
    <p className="text-xs" data-testid="applied-result">
      Applied at revision {result.revision}: {o.name} {verdict}
      {o.packets.length > 0
        ? `, ${total} damage (${o.packets.map((p) => `${p.amount} ${p.damageType}`).join(', ')})`
        : ''}
      {o.healing ? `, ${o.healing} healing` : ''}
      {o.costs.length > 0
        ? `, spent ${o.costs.map((c) => `${c.amount} ${c.kind === 'slot' ? `level ${c.level} slot` : (c.id ?? c.kind)}`).join(', ')}`
        : ''}
      .
    </p>
  )
}
