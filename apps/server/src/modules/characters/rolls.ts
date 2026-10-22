/**
 * The explicit roll step (docs/RULES_ENGINE.md §6, ARCHITECTURE.md §6): the server plans, rolls
 * with the cryptographic RNG, stores the roll, and a later commit consumes it exactly once.
 */
import { TRPCError } from '@trpc/server'
import { and, eq, isNull } from 'drizzle-orm'
import {
  createCryptoRng,
  dieRoller,
  roll as rollExpression,
  rollD20,
  type DieRoller,
} from '@scriptorium/dice/roll'
import {
  applyRolls,
  planAction,
  type ActionContext,
  type ActionOutcome,
  type ActionPlan,
  type ActionRef,
  type RollInputs,
} from '@scriptorium/rules-engine'
import { schema, type Db } from '../../db/client.js'
import { CommandError, type CommandRunner } from '../../core/commands.js'
import { newId } from '../../core/ids.js'
import type { Scope } from '../../core/policy.js'
import { characterRootUids, loadSnapshot } from './snapshot.js'
import type { CharacterRepo } from './repo.js'

export type RollResults = RollInputs & {
  /** Every d20 rolled for the attack or check (two under advantage or disadvantage). */
  d20?: number[]
  damageDetails?: Record<string, string>
}

export type StoredRoll = {
  id: string
  characterId: string
  ref: ActionRef
  ctx: ActionContext
  plan: ActionPlan
  results: RollResults
}

export function createRollService(deps: {
  db: Db
  repo: CharacterRepo
  commands: CommandRunner
  dice?: DieRoller
}) {
  const dice = deps.dice ?? dieRoller(createCryptoRng())

  function assertOwner(scope: Scope, ownerUserId: string): void {
    if (scope.role === 'admin') return
    if (scope.userId !== ownerUserId)
      throw new TRPCError({ code: 'FORBIDDEN', message: 'That character belongs to someone else.' })
  }

  async function loadForPlanning(scope: Scope, characterId: string) {
    const row = await deps.repo.getRow(deps.db, characterId)
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
    assertOwner(scope, row.ownerUserId)
    const current = await deps.commands.view(characterId)
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
    const pinned = await deps.repo.getPinnedRefs(deps.db, characterId)
    const { snapshot } = await loadSnapshot(deps.db, characterRootUids(current.aggregate), pinned)
    return { ...current, snapshot }
  }

  return {
    /** The plan for an action with the current situation; nothing is rolled or spent. */
    async plan(
      scope: Scope,
      characterId: string,
      ref: ActionRef,
      ctx: ActionContext = {},
    ): Promise<ActionPlan> {
      const current = await loadForPlanning(scope, characterId)
      return planAction(current.sheet, current.aggregate, ref, ctx, current.snapshot)
    },

    /**
     * Plans again on the server, rolls everything the plan needs (attack with its mode, each
     * damage packet with the crit formula when the attack was a critical, healing, checks) and
     * stores the roll for a single commit.
     */
    async roll(
      scope: Scope,
      characterId: string,
      ref: ActionRef,
      ctx: ActionContext = {},
    ): Promise<StoredRoll> {
      const current = await loadForPlanning(scope, characterId)
      const plan = planAction(current.sheet, current.aggregate, ref, ctx, current.snapshot)
      if (plan.blocked)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot ${plan.name}: ${plan.blocked}.`,
        })
      const results: RollResults = {}
      let critical = false
      if (plan.attack) {
        const d20 = rollD20({
          dice,
          mode: plan.attack.mode,
          modifier: plan.attack.bonus,
          critRange: plan.attack.critRange,
        })
        results.attack = { natural: d20.natural, total: d20.total }
        results.d20 = d20.dice
        critical = d20.isCritical
      }
      if (plan.check) {
        const d20 = rollD20({ dice, mode: plan.check.mode, modifier: plan.check.bonus })
        results.check = { natural: d20.natural, total: d20.total }
        results.d20 = d20.dice
      }
      if (plan.damage.length > 0) {
        results.damage = {}
        results.damageDetails = {}
        for (const packet of plan.damage) {
          const rolled = rollExpression(critical ? packet.critFormula : packet.formula, { dice })
          results.damage[packet.id] = rolled.total
          results.damageDetails[packet.id] = rolled.breakdown
        }
      }
      if (plan.healing !== undefined) {
        const rolled = rollExpression(plan.healing, { dice })
        results.healing = rolled.total
        results.damageDetails = { ...results.damageDetails, healing: rolled.breakdown }
      }
      const id = newId()
      await deps.db.insert(schema.rolls).values({
        id,
        requestedBy: scope.userId ?? null,
        context: { characterId, ref, ctx, plan },
        expression: describeExpression(plan, critical),
        results,
      })
      return { id, characterId, ref, ctx, plan, results }
    },

    /** One hit die for a short rest or a rolled level-up; recorded in the roll log, never consumed. */
    async rollHitDie(scope: Scope, characterId: string, die: 'd4' | 'd6' | 'd8' | 'd10' | 'd12') {
      const row = await deps.repo.getRow(deps.db, characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      assertOwner(scope, row.ownerUserId)
      const rolled = rollExpression(`1${die}`, { dice })
      await deps.db.insert(schema.rolls).values({
        id: newId(),
        requestedBy: scope.userId ?? null,
        context: { characterId, kind: 'hitDie', die },
        expression: `1${die}`,
        results: { total: rolled.total, breakdown: rolled.breakdown },
      })
      return { die, roll: rolled.total, breakdown: rolled.breakdown }
    },

    /** Applies a stored roll once: consumes it, derives the outcome and runs `applyActionOutcome`. */
    async commit(
      scope: Scope,
      input: {
        characterId: string
        commandId: string
        expectedRevision: number
        rollId: string
        targetAc?: number
      },
    ) {
      const row = await deps.repo.getRow(deps.db, input.characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      assertOwner(scope, row.ownerUserId)
      const [stored] = await deps.db
        .select()
        .from(schema.rolls)
        .where(eq(schema.rolls.id, input.rollId))
      if (!stored) throw new TRPCError({ code: 'NOT_FOUND', message: 'Roll not found.' })
      const context = stored.context as { characterId: string; plan: ActionPlan }
      if (context.characterId !== input.characterId)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That roll belongs to another character.',
        })
      if (stored.consumedByCommandId && stored.consumedByCommandId !== input.commandId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'That roll was already applied.',
        })
      }
      const outcome: ActionOutcome = applyRolls(
        context.plan,
        stored.results as RollInputs,
        input.targetAc !== undefined ? { targetAc: input.targetAc } : {},
      )
      try {
        const result = await deps.commands.run(
          {
            commandId: input.commandId,
            characterId: input.characterId,
            expectedRevision: input.expectedRevision,
            command: { type: 'applyActionOutcome', outcome },
            actorUserId: scope.userId ?? null,
          },
          {
            prepare: async (tx) => {
              const consumed = await tx
                .update(schema.rolls)
                .set({ consumedByCommandId: input.commandId })
                .where(
                  and(eq(schema.rolls.id, input.rollId), isNull(schema.rolls.consumedByCommandId)),
                )
                .returning({ id: schema.rolls.id })
              if (consumed.length === 0)
                throw new CommandError('PRECONDITION_FAILED', 'that roll was already applied')
            },
          },
        )
        return { ...result, outcome }
      } catch (error) {
        if (error instanceof CommandError) {
          const code =
            error.code === 'CONFLICT'
              ? 'CONFLICT'
              : error.code === 'NOT_FOUND'
                ? 'NOT_FOUND'
                : error.code === 'PRECONDITION_FAILED'
                  ? 'PRECONDITION_FAILED'
                  : 'BAD_REQUEST'
          throw new TRPCError({ code, message: error.message, cause: error.details })
        }
        throw error
      }
    },
  }
}

function describeExpression(plan: ActionPlan, critical: boolean): string {
  const parts: string[] = []
  if (plan.attack || plan.check) parts.push('1d20')
  for (const packet of plan.damage) parts.push(critical ? packet.critFormula : packet.formula)
  if (plan.healing !== undefined) parts.push(plan.healing)
  return parts.join(' | ')
}

export type RollService = ReturnType<typeof createRollService>
