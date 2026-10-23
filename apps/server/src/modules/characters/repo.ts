/** Character aggregate rows (docs/DATA_MODEL.md §3). Every write goes through core/commands. */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type {
  CharacterAggregate,
  CharacterDefinition,
  CharacterState,
  CommandEvent,
  InventoryItem,
  Patch,
} from '@scriptorium/rules-engine'
import { schema, type Db } from '../../db/client.js'
import { newId } from '../../core/ids.js'
import type { ContentRef } from './snapshot.js'

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Executor = Db | Tx

export type CharacterRow = {
  id: string
  ownerUserId: string
  campaignId: string | null
  rulesetId: string
  name: string
  status: string
  revision: number
  summary: unknown
  createdAt: Date
  updatedAt: Date
}

export type CharacterSummary = {
  level: number
  classes: Array<{ name: string; level: number; subclassName?: string }>
  species?: string
  hp: { current: number; max: number }
}

export function createCharacterRepo(db: Db) {
  return {
    async list(ownerUserId: string): Promise<Array<CharacterRow & { speciesUid: string | null }>> {
      return db
        .select({
          id: schema.characters.id,
          ownerUserId: schema.characters.ownerUserId,
          campaignId: schema.characters.campaignId,
          rulesetId: schema.characters.rulesetId,
          name: schema.characters.name,
          status: schema.characters.status,
          revision: schema.characters.revision,
          summary: schema.characters.summary,
          speciesUid: schema.characters.speciesUid,
          createdAt: schema.characters.createdAt,
          updatedAt: schema.characters.updatedAt,
        })
        .from(schema.characters)
        .where(
          and(eq(schema.characters.ownerUserId, ownerUserId), isNull(schema.characters.deletedAt)),
        )
        .orderBy(desc(schema.characters.updatedAt))
    },

    async getRow(
      executor: Executor,
      id: string,
      options: { forUpdate?: boolean } = {},
    ): Promise<CharacterRow | null> {
      const query = executor
        .select({
          id: schema.characters.id,
          ownerUserId: schema.characters.ownerUserId,
          campaignId: schema.characters.campaignId,
          rulesetId: schema.characters.rulesetId,
          name: schema.characters.name,
          status: schema.characters.status,
          revision: schema.characters.revision,
          summary: schema.characters.summary,
          createdAt: schema.characters.createdAt,
          updatedAt: schema.characters.updatedAt,
        })
        .from(schema.characters)
        .where(and(eq(schema.characters.id, id), isNull(schema.characters.deletedAt)))
        .limit(1)
      const [row] = options.forUpdate ? await query.for('update') : await query
      return row ?? null
    },

    async insert(tx: Executor, ownerUserId: string, aggregate: CharacterAggregate): Promise<void> {
      const d = aggregate.definition
      await tx.insert(schema.characters).values({
        id: aggregate.id,
        ownerUserId,
        rulesetId: aggregate.rulesetId,
        name: aggregate.name,
        abilityMethod: d.abilityMethod,
        baseAbilities: d.baseAbilities,
        speciesUid: d.speciesUid ?? null,
        backgroundUid: d.backgroundUid ?? null,
        xp: d.xp,
        hpMode: d.hpMode,
        revision: aggregate.revision,
      })
      await tx.insert(schema.characterState).values(stateRow(aggregate.id, aggregate.state))
      await writeDefinitionRows(tx, aggregate.id, d)
      await writeInventoryRows(tx, aggregate.id, aggregate.inventory)
    },

    async loadAggregate(executor: Executor, row: CharacterRow): Promise<CharacterAggregate> {
      const [base] = await executor
        .select({
          abilityMethod: schema.characters.abilityMethod,
          baseAbilities: schema.characters.baseAbilities,
          speciesUid: schema.characters.speciesUid,
          backgroundUid: schema.characters.backgroundUid,
          xp: schema.characters.xp,
          hpMode: schema.characters.hpMode,
        })
        .from(schema.characters)
        .where(eq(schema.characters.id, row.id))
      if (!base) throw new Error('character vanished')
      const classes = await executor
        .select()
        .from(schema.characterClasses)
        .where(eq(schema.characterClasses.characterId, row.id))
        .orderBy(asc(schema.characterClasses.order))
      const choices = await executor
        .select()
        .from(schema.characterChoices)
        .where(eq(schema.characterChoices.characterId, row.id))
      const spells = await executor
        .select()
        .from(schema.characterSpells)
        .where(eq(schema.characterSpells.characterId, row.id))
      const overrides = await executor
        .select()
        .from(schema.characterOverrides)
        .where(eq(schema.characterOverrides.characterId, row.id))
      const items = await executor
        .select()
        .from(schema.characterItems)
        .where(eq(schema.characterItems.characterId, row.id))
        .orderBy(asc(schema.characterItems.sortOrder))
      const [state] = await executor
        .select()
        .from(schema.characterState)
        .where(eq(schema.characterState.characterId, row.id))
      if (!state) throw new Error('character state missing')
      const definition: CharacterDefinition = {
        abilityMethod: base.abilityMethod as CharacterDefinition['abilityMethod'],
        baseAbilities: base.baseAbilities as CharacterDefinition['baseAbilities'],
        ...(base.speciesUid ? { speciesUid: base.speciesUid } : {}),
        ...(base.backgroundUid ? { backgroundUid: base.backgroundUid } : {}),
        classes: classes.map((c) => ({
          classUid: c.classUid,
          ...(c.subclassUid ? { subclassUid: c.subclassUid } : {}),
          level: c.level,
          order: c.order,
          hitDiceRolls: c.hitDiceRolls as number[],
        })),
        choices: Object.fromEntries(
          choices.map((c) => [c.choiceKey, c.selected as CharacterDefinition['choices'][string]]),
        ),
        spells: spells.map((s) => ({
          spellUid: s.spellUid,
          origin: s.origin,
          known: s.known,
          prepared: s.prepared,
          alwaysPrepared: s.alwaysPrepared,
        })),
        overrides: overrides.map((o) => ({
          statPath: o.statPath,
          value: o.value as number | string | boolean,
          ...(o.note ? { note: o.note } : {}),
        })),
        hpMode: base.hpMode as CharacterDefinition['hpMode'],
        xp: base.xp,
      }
      const inventory: InventoryItem[] = items.map((i) => ({
        id: i.id,
        ...(i.itemUid ? { itemUid: i.itemUid } : {}),
        ...(i.customItem ? { customItem: i.customItem as InventoryItem['customItem'] } : {}),
        quantity: i.quantity,
        equipped: i.equipped,
        attuned: i.attuned,
        ...(i.chargesCurrent !== null ? { chargesCurrent: i.chargesCurrent } : {}),
        ...(i.containerItemId ? { containerItemId: i.containerItemId } : {}),
        ...(i.notes ? { notes: i.notes } : {}),
        sortOrder: i.sortOrder,
      }))
      const runtime: CharacterState = {
        hpCurrent: state.hpCurrent,
        hpTemp: state.hpTemp,
        deathSaves: state.deathSaves as CharacterState['deathSaves'],
        hitDiceSpent: state.hitDiceSpent as Record<string, number>,
        spellSlotsUsed: state.spellSlotsUsed as Record<string, number>,
        pactSlotsUsed: state.pactSlotsUsed,
        resources: state.resources as Record<string, number>,
        conditions: state.conditions as CharacterState['conditions'],
        exhaustion: state.exhaustion,
        concentration: state.concentration as CharacterState['concentration'],
        inspiration: state.inspiration,
        currency: state.currency as CharacterState['currency'],
        activeEffects: state.activeEffects as CharacterState['activeEffects'],
        toggles: state.toggles as Record<string, boolean>,
        combat: state.combat as CharacterState['combat'],
        assumptions: state.assumptions as Record<string, unknown>,
      }
      return {
        id: row.id,
        rulesetId: row.rulesetId,
        name: row.name,
        revision: row.revision,
        definition,
        inventory,
        state: runtime,
      }
    },

    /** Rewrites the sections a patch touches and bumps the revision. */
    async applyPatch(
      tx: Executor,
      id: string,
      patch: Patch,
      revision: number,
      summary: CharacterSummary,
    ): Promise<void> {
      const set: Record<string, unknown> = { revision, summary, updatedAt: new Date() }
      if (patch.name !== undefined) set['name'] = patch.name
      if (patch.definition) {
        const d = patch.definition
        Object.assign(set, {
          abilityMethod: d.abilityMethod,
          baseAbilities: d.baseAbilities,
          speciesUid: d.speciesUid ?? null,
          backgroundUid: d.backgroundUid ?? null,
          xp: d.xp,
          hpMode: d.hpMode,
          status: d.classes.length > 0 ? 'active' : 'draft',
        })
        await tx.delete(schema.characterClasses).where(eq(schema.characterClasses.characterId, id))
        await tx.delete(schema.characterChoices).where(eq(schema.characterChoices.characterId, id))
        await tx.delete(schema.characterSpells).where(eq(schema.characterSpells.characterId, id))
        await tx
          .delete(schema.characterOverrides)
          .where(eq(schema.characterOverrides.characterId, id))
        await writeDefinitionRows(tx, id, d)
      }
      if (patch.inventory) {
        await tx.delete(schema.characterItems).where(eq(schema.characterItems.characterId, id))
        await writeInventoryRows(tx, id, patch.inventory)
      }
      if (patch.state) {
        const { characterId: _ignored, ...values } = stateRow(id, patch.state)
        await tx
          .update(schema.characterState)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(schema.characterState.characterId, id))
      }
      await tx.update(schema.characters).set(set).where(eq(schema.characters.id, id))
    },

    async appendEvent(
      tx: Executor,
      id: string,
      actorUserId: string | null,
      event: CommandEvent,
      revisionAfter: number,
      actionId?: string,
    ): Promise<string> {
      const eventId = newId()
      await tx.insert(schema.characterEvents).values({
        id: eventId,
        characterId: id,
        actorUserId,
        commandType: event.type,
        payload: event.payload,
        before: event.before,
        after: event.after,
        summary: event.summary,
        revisionAfter,
        reversible: event.reversible,
        actionId: actionId ?? null,
      })
      return eventId
    },

    async listEvents(executor: Executor, id: string, limit: number) {
      return executor
        .select({
          id: schema.characterEvents.id,
          type: schema.characterEvents.commandType,
          summary: schema.characterEvents.summary,
          before: schema.characterEvents.before,
          revisionAfter: schema.characterEvents.revisionAfter,
          reversible: schema.characterEvents.reversible,
          actorUserId: schema.characterEvents.actorUserId,
          createdAt: schema.characterEvents.createdAt,
        })
        .from(schema.characterEvents)
        .where(eq(schema.characterEvents.characterId, id))
        .orderBy(desc(schema.characterEvents.revisionAfter))
        .limit(limit)
    },

    async insertSnapshot(
      tx: Executor,
      aggregate: CharacterAggregate,
      reason: string,
    ): Promise<string> {
      const id = newId()
      await tx
        .insert(schema.characterSnapshots)
        .values({ id, characterId: aggregate.id, revision: aggregate.revision, reason, aggregate })
      return id
    },

    async listSnapshots(executor: Executor, id: string) {
      return executor
        .select({
          id: schema.characterSnapshots.id,
          revision: schema.characterSnapshots.revision,
          reason: schema.characterSnapshots.reason,
          createdAt: schema.characterSnapshots.createdAt,
        })
        .from(schema.characterSnapshots)
        .where(eq(schema.characterSnapshots.characterId, id))
        .orderBy(desc(schema.characterSnapshots.revision))
        .limit(50)
    },

    async getSnapshot(executor: Executor, id: string, snapshotId: string) {
      const [row] = await executor
        .select()
        .from(schema.characterSnapshots)
        .where(
          and(
            eq(schema.characterSnapshots.characterId, id),
            eq(schema.characterSnapshots.id, snapshotId),
          ),
        )
      return row ?? null
    },

    /** Keeps the last `keep` automatic snapshots per character; manual ones are kept forever. */
    async pruneSnapshots(tx: Executor, id: string, keep: number): Promise<void> {
      await tx.execute(
        sql`delete from character_snapshots where character_id = ${id} and reason <> 'manual' and id not in (select id from character_snapshots where character_id = ${id} and reason <> 'manual' order by revision desc limit ${keep})`,
      )
    },

    async getPinnedRefs(executor: Executor, id: string): Promise<Map<string, string>> {
      const rows = await executor
        .select({
          refPath: schema.characterContentRefs.refPath,
          versionId: schema.characterContentRefs.versionId,
        })
        .from(schema.characterContentRefs)
        .where(eq(schema.characterContentRefs.characterId, id))
      return new Map(rows.map((r) => [r.refPath, r.versionId]))
    },

    async replaceRefs(tx: Executor, id: string, refs: ContentRef[]): Promise<void> {
      await tx
        .delete(schema.characterContentRefs)
        .where(eq(schema.characterContentRefs.characterId, id))
      if (refs.length === 0) return
      await tx.insert(schema.characterContentRefs).values(
        refs.map((r) => ({
          characterId: id,
          entryId: r.entryId,
          versionId: r.versionId,
          refPath: r.uid,
        })),
      )
    },

    async getReceipt(executor: Executor, commandId: string) {
      const [row] = await executor
        .select()
        .from(schema.commandReceipts)
        .where(eq(schema.commandReceipts.commandId, commandId))
      return row ?? null
    },

    async insertReceipt(
      tx: Executor,
      commandId: string,
      actorUserId: string | null,
      aggregateId: string,
      outcome: unknown,
    ): Promise<void> {
      await tx
        .insert(schema.commandReceipts)
        .values({ commandId, actorUserId, aggregateType: 'character', aggregateId, outcome })
    },

    /**
     * Where the character is still in use (issue #22): campaign rosters it is pending or approved
     * on, and encounters that are not completed. Completed encounters keep their participant rows
     * as history and never block anything.
     */
    async dependencies(executor: Executor, id: string) {
      const rosters = await executor
        .select({
          campaignId: schema.campaigns.id,
          campaignName: schema.campaigns.name,
          status: schema.campaignCharacters.status,
        })
        .from(schema.campaignCharacters)
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignCharacters.campaignId))
        .where(
          and(
            eq(schema.campaignCharacters.characterId, id),
            inArray(schema.campaignCharacters.status, ['pending', 'approved']),
          ),
        )
      const encounters = await executor
        .select({
          encounterId: schema.encounters.id,
          encounterName: schema.encounters.name,
          status: schema.encounters.status,
        })
        .from(schema.encounterParticipants)
        .innerJoin(
          schema.encounters,
          eq(schema.encounters.id, schema.encounterParticipants.encounterId),
        )
        .where(
          and(
            eq(schema.encounterParticipants.characterId, id),
            ne(schema.encounters.status, 'completed'),
          ),
        )
      return { rosters, encounters }
    },

    /** Soft delete; false when the row was already deleted (or never existed). */
    async softDelete(id: string): Promise<boolean> {
      const rows = await db
        .update(schema.characters)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.characters.id, id), isNull(schema.characters.deletedAt)))
        .returning({ id: schema.characters.id })
      return rows.length > 0
    },
  }
}

export type CharacterRepo = ReturnType<typeof createCharacterRepo>

function stateRow(characterId: string, s: CharacterState) {
  return {
    characterId,
    hpCurrent: s.hpCurrent,
    hpTemp: s.hpTemp,
    deathSaves: s.deathSaves,
    hitDiceSpent: s.hitDiceSpent,
    spellSlotsUsed: s.spellSlotsUsed,
    pactSlotsUsed: s.pactSlotsUsed,
    resources: s.resources,
    conditions: s.conditions,
    exhaustion: s.exhaustion,
    concentration: s.concentration,
    inspiration: s.inspiration,
    currency: s.currency,
    activeEffects: s.activeEffects,
    toggles: s.toggles,
    combat: s.combat,
    assumptions: s.assumptions,
  }
}

async function writeDefinitionRows(
  tx: Executor,
  id: string,
  d: CharacterDefinition,
): Promise<void> {
  if (d.classes.length > 0) {
    await tx.insert(schema.characterClasses).values(
      d.classes.map((c) => ({
        id: newId(),
        characterId: id,
        classUid: c.classUid,
        subclassUid: c.subclassUid ?? null,
        level: c.level,
        order: c.order,
        hitDiceRolls: c.hitDiceRolls ?? [],
      })),
    )
  }
  const choices = Object.entries(d.choices)
  if (choices.length > 0) {
    await tx.insert(schema.characterChoices).values(
      choices.map(([choiceKey, selected]) => ({
        id: newId(),
        characterId: id,
        choiceKey,
        selected,
      })),
    )
  }
  if (d.spells.length > 0) {
    await tx.insert(schema.characterSpells).values(
      d.spells.map((s) => ({
        id: newId(),
        characterId: id,
        spellUid: s.spellUid,
        origin: s.origin,
        known: s.known,
        prepared: s.prepared,
        alwaysPrepared: s.alwaysPrepared,
      })),
    )
  }
  if (d.overrides.length > 0) {
    await tx.insert(schema.characterOverrides).values(
      d.overrides.map((o) => ({
        id: newId(),
        characterId: id,
        statPath: o.statPath,
        value: o.value,
        note: o.note ?? null,
      })),
    )
  }
}

async function writeInventoryRows(
  tx: Executor,
  id: string,
  inventory: InventoryItem[],
): Promise<void> {
  if (inventory.length === 0) return
  await tx.insert(schema.characterItems).values(
    inventory.map((i, index) => ({
      id: i.id,
      characterId: id,
      itemUid: i.itemUid ?? null,
      customItem: i.customItem ?? null,
      quantity: i.quantity,
      equipped: i.equipped,
      attuned: i.attuned,
      chargesCurrent: i.chargesCurrent ?? null,
      containerItemId: i.containerItemId ?? null,
      notes: i.notes ?? null,
      sortOrder: i.sortOrder ?? index,
    })),
  )
}
