import { TRPCError } from '@trpc/server'
import {
  canUndo,
  compensatingCommand,
  createAggregate,
  type CharacterAggregate,
  type CharacterCommand,
  type ComputedSheet,
} from '@scriptorium/rules-engine'
import { randomUUID } from 'node:crypto'
import type { Db } from '../../db/client.js'
import { CommandError, summaryOf, type CommandRunner } from '../../core/commands.js'
import { newId } from '../../core/ids.js'
import type { Scope } from '../../core/policy.js'
import type { DomainEvent, EventBus } from '../../core/events.js'
import type { CharacterRepo } from './repo.js'
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
}) {
  const { repo, commands } = deps

  function assertOwner(scope: Scope, ownerUserId: string): void {
    if (scope.role === 'admin') return
    if (scope.userId !== ownerUserId)
      throw new TRPCError({ code: 'FORBIDDEN', message: 'That character belongs to someone else.' })
  }

  async function load(scope: Scope, characterId: string): Promise<CharacterView> {
    const current = await commands.view(characterId)
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
    assertOwner(scope, current.ownerUserId)
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
      assertOwner(scope, row.ownerUserId)
      yield { type: 'ready', characterId, revision: row.revision }
      const queue: LiveEvent[] = []
      let wake: (() => void) | null = null
      const unsubscribe = deps.events.subscribe((event) => {
        if (event.characterId !== characterId) return
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
      const aggregate = createAggregate({
        id: newId(),
        rulesetId: input.rulesetId,
        name: input.name,
        definition: {
          abilityMethod: input.abilityMethod,
          baseAbilities: input.baseAbilities ?? standardArrayDefault(ruleset.config.standardArray),
          ...(input.speciesUid ? { speciesUid: input.speciesUid } : {}),
          ...(input.backgroundUid ? { backgroundUid: input.backgroundUid } : {}),
          classes: input.classUid ? [{ classUid: input.classUid, level: 1, order: 0 }] : [],
          hpMode: input.hpMode,
        },
      })
      const owner = scope.userId
      const created = await deps.db.transaction(async (tx) => {
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
        return { aggregate, sheet }
      })
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
      },
    ) {
      const row = await repo.getRow(deps.db, request.characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      assertOwner(scope, row.ownerUserId)
      try {
        const result = await commands.run({ ...request, actorUserId: scope.userId ?? null })
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
