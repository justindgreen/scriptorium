import { useMutation } from '@tanstack/react-query'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ABILITY_NAMES, POINT_BUY_COST, STANDARD_ARRAY, type AbilityKey } from '@/lib/characters'
import { errorMessage, trpcClient } from '@/lib/trpc'
import { ABILITIES, selectClass } from '../character/shared'

export type AbilityMethod = 'standard' | 'point_buy' | 'manual' | 'rolled'
export type Scores = Record<AbilityKey, number>
export type AbilityRoll = Awaited<ReturnType<typeof trpcClient.characters.rollAbilities.mutate>>

/** 2014 point buy, mirrored from the ruleset table for display; the engine validates. */
export const POINT_BUY_BUDGET = 27
export const POINT_BUY_MIN = 8
export const POINT_BUY_MAX = 15

/** Values assigned to STR, DEX, CON, INT, WIS, CHA in that order. */
export function assign(values: number[]): Scores {
  return Object.fromEntries(ABILITIES.map((a, i) => [a, values[i] ?? 10])) as Scores
}

/** Starting scores for each method: the standard array pre-assigned in order, six 8s, six 10s. */
export function defaultScores(method: AbilityMethod): Scores {
  if (method === 'standard') return assign(STANDARD_ARRAY)
  if (method === 'point_buy') return assign(ABILITIES.map(() => POINT_BUY_MIN))
  return assign(ABILITIES.map(() => 10))
}

export function pointsSpent(scores: Scores): number {
  return ABILITIES.reduce((n, a) => n + (POINT_BUY_COST[scores[a]] ?? 0), 0)
}

function stepCost(score: number): number {
  return (POINT_BUY_COST[score + 1] ?? 0) - (POINT_BUY_COST[score] ?? 0)
}

/**
 * A fixed pool of values (the standard array, a roll) is assigned by swapping: choosing a value
 * another ability holds trades the two, so every value stays used exactly once.
 */
export function swapTo(scores: Scores, ability: AbilityKey, value: number): Scores {
  const previous = scores[ability]
  const other = ABILITIES.find((a) => a !== ability && scores[a] === value)
  const next = { ...scores, [ability]: value }
  if (other) next[other] = previous
  return next
}

/**
 * Ability scores per method (issue #3): the standard array as six unique assignments, point buy
 * with a budget and bounded steps, rolled scores from a recorded server roll assigned like the
 * array, and manual entry. No rules math here beyond mirroring the point-buy table for display.
 */
export function AbilityScores({
  method,
  scores,
  roll,
  onChange,
  onRoll,
  onError,
}: {
  method: AbilityMethod
  scores: Scores
  roll: AbilityRoll | null
  onChange: (scores: Scores) => void
  onRoll: (roll: AbilityRoll) => void
  onError: (message: string | null) => void
}) {
  const rollAbilities = useMutation({
    mutationFn: () => trpcClient.characters.rollAbilities.mutate(),
    onSuccess: (rolled) => {
      onError(null)
      onRoll(rolled)
    },
    onError: (e) => onError(errorMessage(e)),
  })
  if (method === 'rolled' && !roll) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Rolls 4d6 and keeps the three highest, six times, on the server. The results are recorded
          with the character and cannot be edited afterwards.
        </p>
        <div>
          <Button
            type="button"
            onClick={() => rollAbilities.mutate()}
            disabled={rollAbilities.isPending}
            data-testid="roll-abilities"
          >
            {rollAbilities.isPending ? 'Rolling…' : 'Roll ability scores'}
          </Button>
        </div>
      </div>
    )
  }
  const pool = method === 'standard' ? STANDARD_ARRAY : method === 'rolled' ? roll!.scores : null
  const left = POINT_BUY_BUDGET - pointsSpent(scores)
  return (
    <div className="grid gap-3">
      {method === 'rolled' && roll ? (
        <ol className="flex flex-wrap gap-2 text-sm" data-testid="rolled-scores">
          {roll.scores.map((s, i) => (
            <li key={i} className="rounded-md border px-2 py-1 tabular">
              <span className="font-semibold">{s}</span>{' '}
              <span className="text-xs text-muted-foreground">{roll.breakdowns[i]}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {method === 'point_buy' ? (
        <p className="text-sm" data-testid="pb-points" aria-live="polite">
          <span className="font-semibold tabular">{left}</span> of {POINT_BUY_BUDGET} points left ·
          scores {POINT_BUY_MIN} to {POINT_BUY_MAX}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ABILITIES.map((a) => (
          <FormField key={a} id={`ability-${a}`} label={ABILITY_NAMES[a]}>
            {pool ? (
              <select
                id={`ability-${a}`}
                className={selectClass}
                value={scores[a]}
                onChange={(e) => onChange(swapTo(scores, a, Number(e.target.value)))}
                data-testid={`ability-${a}`}
              >
                {pool.map((v, i) => (
                  <option key={i} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : method === 'point_buy' ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Lower ${ABILITY_NAMES[a]}`}
                  disabled={scores[a] <= POINT_BUY_MIN}
                  onClick={() => onChange({ ...scores, [a]: scores[a] - 1 })}
                  data-testid={`pb-dec-${a}`}
                >
                  −
                </Button>
                <output
                  id={`ability-${a}`}
                  className="w-8 text-center font-semibold tabular"
                  data-testid={`ability-${a}`}
                >
                  {scores[a]}
                </output>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Raise ${ABILITY_NAMES[a]}`}
                  disabled={scores[a] >= POINT_BUY_MAX || stepCost(scores[a]) > left}
                  onClick={() => onChange({ ...scores, [a]: scores[a] + 1 })}
                  data-testid={`pb-inc-${a}`}
                >
                  +
                </Button>
                <span className="text-xs text-muted-foreground tabular">
                  {POINT_BUY_COST[scores[a]] ?? 0} pt
                </span>
              </div>
            ) : (
              <Input
                id={`ability-${a}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                value={scores[a]}
                onChange={(e) => onChange({ ...scores, [a]: Number(e.target.value) })}
                data-testid={`ability-${a}`}
              />
            )}
          </FormField>
        ))}
      </div>
    </div>
  )
}
