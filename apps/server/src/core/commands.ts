/**
 * The character command path (docs/ARCHITECTURE.md §5): receipts, one transaction with a row lock,
 * optimistic revision check, engine patch, event log, snapshots, content refs, post-commit events.
 */
import { rulesetConfigSchema } from '@scriptorium/content-schema'
import {
  applyCommand,
  computeSheet,
  createRulesetProfile,
  type CharacterAggregate,
  type CharacterCommand,
  type ComputedSheet,
  type RulesetProfile,
} from '@scriptorium/rules-engine'
import type { Db } from '../db/client.js'
import type { CharacterRepo, CharacterSummary } from '../modules/characters/repo.js'
import type { ContentRepo } from '../modules/content/repo.js'
import { characterRootUids, loadSnapshot } from '../modules/characters/snapshot.js'
import type { EventBus } from './events.js'

export type CommandRequest = {
  commandId: string
  characterId: string
  expectedRevision: number
  command: CharacterCommand
  actorUserId: string | null
  /** Receipts are per command id; retries with the same id return the stored outcome. */
}

export type CommandOutcome = {
  revision: number
  eventId: string
  replayed: boolean
  summary: string
}

export class CommandError extends Error {
  constructor(
    public readonly code: 'CONFLICT' | 'NOT_FOUND' | 'BAD_REQUEST' | 'PRECONDITION_FAILED',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = 'CommandError'
  }
}

export const SNAPSHOT_RETENTION = 20

export function createCommandRunner(deps: {
  db: Db
  characters: CharacterRepo
  content: ContentRepo
  events: EventBus
}) {
  const profiles = new Map<string, Promise<RulesetProfile>>()

  async function rulesetProfile(id: string): Promise<RulesetProfile> {
    let cached = profiles.get(id)
    if (!cached) {
      cached = deps.content.getRulesetConfig(id).then((config) => {
        if (!config) throw new CommandError('PRECONDITION_FAILED', `ruleset ${id} is not installed`)
        return createRulesetProfile(rulesetConfigSchema.parse(config))
      })
      profiles.set(id, cached)
      cached.catch(() => profiles.delete(id))
    }
    return cached
  }

  /** Loads the aggregate, its pinned snapshot and the computed sheet (read path). */
  async function view(characterId: string): Promise<{
    aggregate: CharacterAggregate
    sheet: ComputedSheet
    ownerUserId: string
    status: string
  } | null> {
    const row = await deps.characters.getRow(deps.db, characterId)
    if (!row) return null
    const aggregate = await deps.characters.loadAggregate(deps.db, row)
    const pinned = await deps.characters.getPinnedRefs(deps.db, characterId)
    const { snapshot } = await loadSnapshot(deps.db, characterRootUids(aggregate), pinned)
    const sheet = computeSheet(aggregate, snapshot, await rulesetProfile(aggregate.rulesetId))
    return { aggregate, sheet, ownerUserId: row.ownerUserId, status: row.status }
  }

  async function run(
    request: CommandRequest,
  ): Promise<CommandOutcome & { sheet: ComputedSheet; aggregate: CharacterAggregate }> {
    const receipt = await deps.characters.getReceipt(deps.db, request.commandId)
    if (receipt) {
      if (receipt.aggregateId !== request.characterId)
        throw new CommandError('BAD_REQUEST', 'that command id was used for another character')
      const current = await view(request.characterId)
      if (!current) throw new CommandError('NOT_FOUND', 'character not found')
      const stored = receipt.outcome as CommandOutcome
      return { ...stored, replayed: true, sheet: current.sheet, aggregate: current.aggregate }
    }

    const result = await deps.db.transaction(async (tx) => {
      const row = await deps.characters.getRow(tx, request.characterId, { forUpdate: true })
      if (!row) throw new CommandError('NOT_FOUND', 'character not found')
      const aggregate = await deps.characters.loadAggregate(tx, row)
      if (row.revision !== request.expectedRevision) {
        throw new CommandError(
          'CONFLICT',
          `the character changed (revision ${row.revision}, you expected ${request.expectedRevision})`,
          { revision: row.revision },
        )
      }
      const pinned = await deps.characters.getPinnedRefs(tx, request.characterId)
      const loaded = await loadSnapshot(tx, characterRootUids(aggregate, [request.command]), pinned)
      const ruleset = await rulesetProfile(aggregate.rulesetId)
      const sheet = computeSheet(aggregate, loaded.snapshot, ruleset)
      const applied = applyCommand(aggregate, sheet, request.command, {
        snapshot: loaded.snapshot,
        ruleset,
      })
      if (!applied.ok)
        throw new CommandError(
          applied.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'BAD_REQUEST',
          applied.message,
          { code: applied.code },
        )

      const revision = row.revision + 1
      if (applied.event.snapshotReason) {
        await deps.characters.insertSnapshot(tx, aggregate, applied.event.snapshotReason)
        await deps.characters.pruneSnapshots(tx, request.characterId, SNAPSHOT_RETENTION)
      }
      // The content the new aggregate references may have grown (a new class, a chosen feature).
      const after = applied.aggregate
      const nextLoaded = await loadSnapshot(tx, characterRootUids(after), pinned)
      const nextSheet = computeSheet({ ...after, revision }, nextLoaded.snapshot, ruleset)
      await deps.characters.applyPatch(
        tx,
        request.characterId,
        applied.patch,
        revision,
        summaryOf(nextSheet, after),
      )
      await deps.characters.replaceRefs(tx, request.characterId, nextLoaded.refs)
      const eventId = await deps.characters.appendEvent(
        tx,
        request.characterId,
        request.actorUserId,
        applied.event,
        revision,
      )
      const outcome: CommandOutcome = {
        revision,
        eventId,
        replayed: false,
        summary: applied.event.summary,
      }
      await deps.characters.insertReceipt(
        tx,
        request.commandId,
        request.actorUserId,
        request.characterId,
        outcome,
      )
      return { outcome, sheet: nextSheet, aggregate: { ...after, revision } }
    })

    deps.events.emit({
      type: 'character.changed',
      characterId: request.characterId,
      revision: result.outcome.revision,
      eventId: result.outcome.eventId,
      commandType: request.command.type,
    })
    return { ...result.outcome, sheet: result.sheet, aggregate: result.aggregate }
  }

  return { run, view, rulesetProfile }
}

export type CommandRunner = ReturnType<typeof createCommandRunner>

export function summaryOf(sheet: ComputedSheet, aggregate: CharacterAggregate): CharacterSummary {
  return {
    level: sheet.level,
    classes: sheet.classes.map((c) => ({
      name: c.name,
      level: c.level,
      ...(c.subclassName ? { subclassName: c.subclassName } : {}),
    })),
    ...(aggregate.definition.speciesUid ? { species: aggregate.definition.speciesUid } : {}),
    hp: { current: sheet.hp.current, max: sheet.hp.max },
  }
}
