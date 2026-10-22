/** Encounter rows: the aggregate, its participants and its append-only log (docs/DATA_MODEL.md §5). */
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { schema, type Db } from '../../db/client.js'
import { newId } from '../../core/ids.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Executor = Db | Tx

export type ParticipantRow = typeof schema.encounterParticipants.$inferSelect
export type EncounterRow = typeof schema.encounters.$inferSelect

export function createEncounterRepo(db: Db) {
  return {
    async create(values: { campaignId: string; name: string }): Promise<string> {
      const id = newId()
      await db.insert(schema.encounters).values({ id, ...values })
      return id
    },

    async get(
      executor: Executor,
      id: string,
      options: { forUpdate?: boolean } = {},
    ): Promise<EncounterRow | null> {
      const query = executor
        .select()
        .from(schema.encounters)
        .where(eq(schema.encounters.id, id))
        .limit(1)
      const [row] = options.forUpdate ? await query.for('update') : await query
      return row ?? null
    },

    async update(
      executor: Executor,
      id: string,
      set: Partial<
        Pick<EncounterRow, 'status' | 'round' | 'turnIndex' | 'currentTurnId' | 'startedAt'>
      > & {
        version: number
      },
    ): Promise<void> {
      await executor
        .update(schema.encounters)
        .set({ ...set, updatedAt: sql`now()` })
        .where(eq(schema.encounters.id, id))
    },

    async participants(executor: Executor, encounterId: string): Promise<ParticipantRow[]> {
      return executor
        .select()
        .from(schema.encounterParticipants)
        .where(eq(schema.encounterParticipants.encounterId, encounterId))
        .orderBy(
          asc(schema.encounterParticipants.sortOrder),
          asc(schema.encounterParticipants.createdAt),
        )
    },

    async participant(executor: Executor, encounterId: string, id: string) {
      const [row] = await executor
        .select()
        .from(schema.encounterParticipants)
        .where(
          and(
            eq(schema.encounterParticipants.encounterId, encounterId),
            eq(schema.encounterParticipants.id, id),
          ),
        )
        .limit(1)
      return row ?? null
    },

    async addParticipant(
      executor: Executor,
      values: Omit<typeof schema.encounterParticipants.$inferInsert, 'id'>,
    ): Promise<string> {
      const id = newId()
      await executor.insert(schema.encounterParticipants).values({ id, ...values })
      return id
    },

    async updateParticipant(
      executor: Executor,
      id: string,
      set: Partial<
        Pick<
          ParticipantRow,
          | 'initiative'
          | 'tiebreak'
          | 'hpCurrent'
          | 'hpTemp'
          | 'conditions'
          | 'combat'
          | 'defeated'
          | 'sortOrder'
        >
      >,
    ): Promise<void> {
      await executor
        .update(schema.encounterParticipants)
        .set(set)
        .where(eq(schema.encounterParticipants.id, id))
    },

    async appendEvent(
      executor: Executor,
      values: {
        encounterId: string
        actorUserId: string | null
        type: string
        payload: unknown
        actionId?: string | null
        versionAfter: number
      },
    ): Promise<string> {
      const id = newId()
      await executor.insert(schema.encounterEvents).values({
        id,
        encounterId: values.encounterId,
        actorUserId: values.actorUserId,
        type: values.type,
        payload: values.payload,
        actionId: values.actionId ?? null,
        versionAfter: values.versionAfter,
      })
      return id
    },

    async events(executor: Executor, encounterId: string, limit: number) {
      return executor
        .select({
          id: schema.encounterEvents.id,
          type: schema.encounterEvents.type,
          payload: schema.encounterEvents.payload,
          actionId: schema.encounterEvents.actionId,
          versionAfter: schema.encounterEvents.versionAfter,
          createdAt: schema.encounterEvents.createdAt,
        })
        .from(schema.encounterEvents)
        .where(eq(schema.encounterEvents.encounterId, encounterId))
        .orderBy(desc(schema.encounterEvents.versionAfter), desc(schema.encounterEvents.createdAt))
        .limit(limit)
    },
  }
}

export type EncounterRepo = ReturnType<typeof createEncounterRepo>
