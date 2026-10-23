import { TRPCError } from '@trpc/server'
import {
  canUndo,
  compensatingCommand,
  createAggregate,
  type CharacterAggregate,
  type CharacterCommand,
  type ComputedSheet,
  validateAbilityScores,
} from '@scriptorium/rules-engine'
import { randomUUID } from 'node:crypto'
import type { Db } from '../../db/client.js'
import { CommandError, summaryOf, type CommandRunner, type Tx } from '../../core/commands.js'
import { newId } from '../../core/ids.js'
import type { Scope } from '../../core/policy.js'
import type { DomainEvent, EventBus } from '../../core/events.js'
import type { ContentRepo } from '../content/repo.js'
import type { CampaignService } from '../campaigns/service.js'
import type { CharacterRepo } from './repo.js'
import { consumeAbilityRoll, requireAbilityRoll } from './rolls.js'
import { characterRootUids, loadSnapshot } from './snapshot.js'
import type { createCharacterSchema } from './schemas.js'
import type { z } from 'zod'

export type LiveEvent = { type: 'ready'; characterId: string; revision: number } | DomainEvent

export type CharacterView = {
  id: string
  ownerUserId: string
  status: string
  revision: number
  aggregate: CharacterAggregate
  sheet: ComputedSheet
}

export function createCharacterService(deps: {
  db: Db
  repo: CharacterRepo
  commands: CommandRunner
  events: EventBus
  content: ContentRepo
  /** Set after construction (the campaign service is built later); DM permissions need it. */
  campaigns?: CampaignService
}) {
  const { repo, commands } = deps

  /** Commands a DM may issue on an approved party character (docs/PRODUCT_SPEC.md §8: grant items, adjust). */
  const DM_COMMANDS = new Set<CharacterCommand['type']>([
    'addItem',
    'applyDamage',
    'heal',
    'setTempHp',
    'applyCondition',
    'removeCondition',
    'setExhaustion',
    'turnStarted',
  ])

  async function isDm(scope: Scope, characterId: string): Promise<boolean> {
    return deps.campaigns ? deps.campaigns.isDmOfCharacter(scope, characterId) : false
  }

  async function assertCanRead(
    scope: Scope,
    row: { id: string; ownerUserId: string },
  ): Promise<void> {
    if (scope.role === 'admin' || scope.userId === row.ownerUserId) return
    if (await isDm(scope, row.id)) return
    throw new TRPCError({ code: 'FORBIDDEN', message: 'That character belongs to someone else.' })
  }

  function assertOwner(scope: Scope, ownerUserId: string): void {
    if (scope.role === 'admin') return
    if (scope.userId !== ownerUserId)
      throw new TRPCError({ code: 'FORBIDDEN', message: 'That character belongs to someone else.' })
  }

  async function load(scope: Scope, characterId: string): Promise<CharacterView> {
    const current = await commands.view(characterId)
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
    await assertCanRead(scope, { id: characterId, ownerUserId: current.ownerUserId })
    return {
      id: characterId,
      ownerUserId: current.ownerUserId,
      status: current.status,
      revision: current.aggregate.revision,
      aggregate: current.aggregate,
      sheet: current.sheet,
    }
  }

  function translate(error: unknown): never {
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

  return {
    async list(scope: Scope) {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      return repo.list(scope.userId)
    },

    get: load,

    /**
     * Live updates for one character (docs/ARCHITECTURE.md §7): authorized like `get`, a `ready`
     * frame with the current revision first (so a reconnecting client can detect a gap), then every
     * post-commit event for this character until the client goes away.
     */
    async *subscribe(
      scope: Scope,
      characterId: string,
      signal: AbortSignal | undefined,
    ): AsyncGenerator<LiveEvent> {
      const row = await repo.getRow(deps.db, characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      // Authorized exactly like `get`: the DM of an approved party character may follow it live too.
      await assertCanRead(scope, row)
      yield { type: 'ready', characterId, revision: row.revision }
      const queue: LiveEvent[] = []
      let wake: (() => void) | null = null
      const unsubscribe = deps.events.subscribe((event) => {
        if (!('characterId' in event) || event.characterId !== characterId) return
        queue.push(event)
        wake?.()
      })
      try {
        while (!signal?.aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve
              signal?.addEventListener('abort', () => resolve(), { once: true })
            })
            wake = null
          }
          while (queue.length > 0 && !signal?.aborted) yield queue.shift()!
        }
      } finally {
        unsubscribe()
      }
    },

    async create(
      scope: Scope,
      input: z.infer<typeof createCharacterSchema>,
    ): Promise<CharacterView> {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const ruleset = await commands.rulesetProfile(input.rulesetId).catch(translate)
      const baseAbilities =
        input.baseAbilities ?? standardArrayDefault(ruleset.config.standardArray)
      // The rules the `setAbilities` command enforces apply at creation too (issue #3), and
      // rolled scores must be the server's recorded roll, consumed inside the creating transaction.
      const problem = validateAbilityScores(input.abilityMethod, baseAbilities, ruleset)
      if (problem)
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Ability scores: ${problem}.` })
      const abilityRollId =
        input.abilityMethod === 'rolled'
          ? await requireAbilityRoll(deps.db, scope, input.abilityRollId, baseAbilities)
          : null
      const aggregate = createAggregate({
        id: newId(),
        rulesetId: input.rulesetId,
        name: input.name,
        definition: {
          abilityMethod: input.abilityMethod,
          baseAbilities,
          ...(input.speciesUid ? { speciesUid: input.speciesUid } : {}),
          ...(input.backgroundUid ? { backgroundUid: input.backgroundUid } : {}),
          classes: input.classUid ? [{ classUid: input.classUid, level: 1, order: 0 }] : [],
          hpMode: input.hpMode,
        },
      })
      const owner = scope.userId
      const created = await deps.db
        .transaction(async (tx) => {
          const loaded = await loadSnapshot(tx, characterRootUids(aggregate))
          for (const uid of [input.speciesUid, input.backgroundUid, input.classUid]) {
            if (uid && !loaded.snapshot.has(uid))
              throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown content ${uid}.` })
          }
          const sheet = (await import('@scriptorium/rules-engine')).computeSheet(
            aggregate,
            loaded.snapshot,
            ruleset,
          )
          aggregate.state.hpCurrent = sheet.hp.max
          await repo.insert(tx, owner, aggregate)
          await repo.applyPatch(tx, aggregate.id, {}, 0, summaryOf(sheet, aggregate))
          await repo.replaceRefs(tx, aggregate.id, loaded.refs)
          if (abilityRollId) await consumeAbilityRoll(tx, abilityRollId, aggregate.id)
          return { aggregate, sheet }
        })
        .catch(translate)
      return {
        id: aggregate.id,
        ownerUserId: owner,
        status: aggregate.definition.classes.length ? 'active' : 'draft',
        revision: 0,
        aggregate: created.aggregate,
        sheet: created.sheet,
      }
    },

    async command(
      scope: Scope,
      request: {
        characterId: string
        commandId: string
        expectedRevision: number
        command: CharacterCommand
        abilityRollId?: string | undefined
      },
    ) {
      const row = await repo.getRow(deps.db, request.characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      if (scope.role !== 'admin' && scope.userId !== row.ownerUserId) {
        if (!DM_COMMANDS.has(request.command.type) || !(await isDm(scope, row.id)))
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'That character belongs to someone else.',
          })
      }
      if (request.command.type === 'addItem' && request.command.itemUid) {
        // Private homebrew is usable only by people who can see it (rule 3: never rely on the UI).
        const visible = await deps.content.getEntry(request.command.itemUid, { viewer: scope })
        if (!visible)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Unknown content ${request.command.itemUid}.`,
          })
      }
      const { abilityRollId, ...commandRequest } = request
      let prepare: ((tx: Tx) => Promise<void>) | undefined
      if (
        commandRequest.command.type === 'setAbilities' &&
        commandRequest.command.method === 'rolled'
      ) {
        // Scores keep the Rolled designation only as the server's recorded roll (issue #3).
        const rollId = await requireAbilityRoll(
          deps.db,
          scope,
          abilityRollId,
          commandRequest.command.abilities,
          commandRequest.commandId,
        )
        prepare = (tx) => consumeAbilityRoll(tx, rollId, commandRequest.commandId)
      }
      try {
        const result = await commands.run(
          { ...commandRequest, actorUserId: scope.userId ?? null },
          prepare ? { prepare } : {},
        )
        return {
          revision: result.revision,
          eventId: result.eventId,
          replayed: result.replayed,
          summary: result.summary,
          sheet: result.sheet,
          aggregate: result.aggregate,
        }
      } catch (error) {
        translate(error)
      }
    },

    async undo(scope: Scope, characterId: string, expectedRevision: number) {
      const row = await repo.getRow(deps.db, characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      assertOwner(scope, row.ownerUserId)
      const events = await repo.listEvents(deps.db, characterId, 21)
      const check = canUndo(
        events.map((e) => ({
          id: e.id,
          type: e.type as CharacterCommand['type'],
          before: e.before as never,
          reversible: e.reversible,
          revisionAfter: e.revisionAfter,
        })),
      )
      if (!check.ok)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Cannot undo: ${check.reason}.`,
        })
      try {
        const result = await commands.run({
          commandId: randomUUID(),
          characterId,
          expectedRevision,
          command: compensatingCommand(check.event),
          actorUserId: scope.userId ?? null,
        })
        return {
          revision: result.revision,
          eventId: result.eventId,
          summary: result.summary,
          sheet: result.sheet,
          aggregate: result.aggregate,
        }
      } catch (error) {
        translate(error)
      }
    },

    async undoAvailability(scope: Scope, characterId: string) {
      const row = await repo.getRow(deps.db, characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      assertOwner(scope, row.ownerUserId)
      const events = await repo.listEvents(deps.db, characterId, 21)
      const check = canUndo(
        events.map((e) => ({
          id: e.id,
          type: e.type as CharacterCommand['type'],
          before: e.before as never,
          reversible: e.reversible,
          revisionAfter: e.revisionAfter,
        })),
      )
      return check.ok
        ? { ok: true as const, eventType: check.event.type }
        : { ok: false as const, reason: check.reason }
    },

    async events(scope: Scope, characterId: string, limit: number) {
      const row = await repo.getRow(deps.db, characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      assertOwner(scope, row.ownerUserId)
      const rows = await repo.listEvents(deps.db, characterId, limit)
      return rows.map(({ before: _before, ...rest }) => rest)
    },

    async snapshots(scope: Scope, characterId: string) {
      const row = await repo.getRow(deps.db, characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      assertOwner(scope, row.ownerUserId)
      return repo.listSnapshots(deps.db, characterId)
    },

    async takeSnapshot(scope: Scope, characterId: string) {
      const current = await load(scope, characterId)
      const id = await repo.insertSnapshot(deps.db, current.aggregate, 'manual')
      return { id }
    },

    async restoreSnapshot(
      scope: Scope,
      characterId: string,
      snapshotId: string,
      expectedRevision: number,
    ) {
      const row = await repo.getRow(deps.db, characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      assertOwner(scope, row.ownerUserId)
      const snapshot = await repo.getSnapshot(deps.db, characterId, snapshotId)
      if (!snapshot) throw new TRPCError({ code: 'NOT_FOUND', message: 'Snapshot not found.' })
      const stored = snapshot.aggregate as CharacterAggregate
      try {
        const result = await commands.run({
          commandId: randomUUID(),
          characterId,
          expectedRevision,
          command: {
            type: 'restoreSnapshot',
            snapshotId,
            aggregate: {
              name: stored.name,
              definition: stored.definition,
              inventory: stored.inventory,
              state: stored.state,
            },
          },
          actorUserId: scope.userId ?? null,
        })
        return {
          revision: result.revision,
          eventId: result.eventId,
          sheet: result.sheet,
          aggregate: result.aggregate,
        }
      } catch (error) {
        translate(error)
      }
    },

    async remove(scope: Scope, characterId: string) {
      const row = await repo.getRow(deps.db, characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      assertOwner(scope, row.ownerUserId)
      await repo.softDelete(characterId)
      deps.events.emit({ type: 'character.deleted', characterId })
      return { ok: true as const }
    },
  }
}

export type CharacterService = ReturnType<typeof createCharacterService>

function standardArrayDefault(array: number[]): CharacterAggregate['definition']['baseAbilities'] {
  const [a = 15, b = 14, c = 13, d = 12, e = 10, f = 8] = array
  return { str: a, dex: b, con: c, int: d, wis: e, cha: f }
}
