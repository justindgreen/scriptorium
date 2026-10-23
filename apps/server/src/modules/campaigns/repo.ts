/** Campaign rows: membership, invites, party characters and shared sources (docs/DATA_MODEL.md §4). */
import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm'
import { schema, type Db } from '../../db/client.js'
import { newId } from '../../core/ids.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Executor = Db | Tx

export type MemberRole = 'dm' | 'player'

export function createCampaignRepo(db: Db) {
  return {
    async listForUser(userId: string) {
      return db
        .select({
          id: schema.campaigns.id,
          name: schema.campaigns.name,
          descriptionMd: schema.campaigns.descriptionMd,
          dmUserId: schema.campaigns.dmUserId,
          status: schema.campaigns.status,
          role: schema.campaignMembers.role,
          updatedAt: schema.campaigns.updatedAt,
        })
        .from(schema.campaignMembers)
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignMembers.campaignId))
        .where(
          and(
            eq(schema.campaignMembers.userId, userId),
            eq(schema.campaignMembers.status, 'active'),
          ),
        )
        .orderBy(desc(schema.campaigns.updatedAt))
    },

    async create(values: {
      name: string
      description: string
      rulesetId: string
      dmUserId: string
    }): Promise<string> {
      const id = newId()
      await db.transaction(async (tx) => {
        await tx.insert(schema.campaigns).values({
          id,
          name: values.name,
          descriptionMd: values.description,
          rulesetId: values.rulesetId,
          dmUserId: values.dmUserId,
        })
        await tx
          .insert(schema.campaignMembers)
          .values({ campaignId: id, userId: values.dmUserId, role: 'dm' })
      })
      return id
    },

    async get(id: string) {
      const [row] = await db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, id))
        .limit(1)
      return row ?? null
    },

    async memberRole(campaignId: string, userId: string): Promise<MemberRole | null> {
      const [row] = await db
        .select({ role: schema.campaignMembers.role })
        .from(schema.campaignMembers)
        .where(
          and(
            eq(schema.campaignMembers.campaignId, campaignId),
            eq(schema.campaignMembers.userId, userId),
            eq(schema.campaignMembers.status, 'active'),
          ),
        )
        .limit(1)
      if (!row) return null
      return row.role === 'dm' || row.role === 'co_dm' ? 'dm' : 'player'
    },

    async members(campaignId: string) {
      return db
        .select({
          userId: schema.campaignMembers.userId,
          name: schema.user.name,
          role: schema.campaignMembers.role,
          joinedAt: schema.campaignMembers.joinedAt,
        })
        .from(schema.campaignMembers)
        .innerJoin(schema.user, eq(schema.user.id, schema.campaignMembers.userId))
        .where(
          and(
            eq(schema.campaignMembers.campaignId, campaignId),
            eq(schema.campaignMembers.status, 'active'),
          ),
        )
        .orderBy(asc(schema.campaignMembers.joinedAt))
    },

    async addMember(campaignId: string, userId: string, role: MemberRole): Promise<void> {
      await db
        .insert(schema.campaignMembers)
        .values({ campaignId, userId, role })
        .onConflictDoUpdate({
          target: [schema.campaignMembers.campaignId, schema.campaignMembers.userId],
          set: { status: 'active' },
        })
    },

    async createInvite(values: {
      campaignId: string
      codeHash: string
      createdBy: string
      expiresAt: Date
      maxUses: number
    }): Promise<string> {
      const id = newId()
      await db.insert(schema.campaignInvites).values({ id, ...values })
      return id
    },

    /** Consumes one use of a valid invite and returns its campaign, or null. */
    async reserveInvite(codeHash: string): Promise<{ campaignId: string } | null> {
      const [row] = await db
        .update(schema.campaignInvites)
        .set({ uses: sql`${schema.campaignInvites.uses} + 1` })
        .where(
          and(
            eq(schema.campaignInvites.codeHash, codeHash),
            gt(schema.campaignInvites.expiresAt, new Date()),
            lt(schema.campaignInvites.uses, schema.campaignInvites.maxUses),
          ),
        )
        .returning({ campaignId: schema.campaignInvites.campaignId })
      return row ?? null
    },

    async submitCharacter(campaignId: string, characterId: string): Promise<void> {
      await db
        .insert(schema.campaignCharacters)
        .values({ campaignId, characterId, status: 'pending' })
        .onConflictDoUpdate({
          target: [schema.campaignCharacters.campaignId, schema.campaignCharacters.characterId],
          set: { status: 'pending', submittedAt: sql`now()`, approvedAt: null, approvedBy: null },
        })
    },

    async approveCharacter(campaignId: string, characterId: string, by: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(schema.campaignCharacters)
          .set({ status: 'approved', approvedBy: by, approvedAt: sql`now()` })
          .where(
            and(
              eq(schema.campaignCharacters.campaignId, campaignId),
              eq(schema.campaignCharacters.characterId, characterId),
            ),
          )
          .returning({ characterId: schema.campaignCharacters.characterId })
        if (rows.length === 0) return false
        await tx
          .update(schema.characters)
          .set({ campaignId, updatedAt: sql`now()` })
          .where(eq(schema.characters.id, characterId))
        return true
      })
    },

    async characters(campaignId: string) {
      return db
        .select({
          characterId: schema.campaignCharacters.characterId,
          status: schema.campaignCharacters.status,
          name: schema.characters.name,
          ownerUserId: schema.characters.ownerUserId,
          ownerName: schema.user.name,
          summary: schema.characters.summary,
          revision: schema.characters.revision,
          submittedAt: schema.campaignCharacters.submittedAt,
        })
        .from(schema.campaignCharacters)
        .innerJoin(
          schema.characters,
          eq(schema.characters.id, schema.campaignCharacters.characterId),
        )
        .innerJoin(schema.user, eq(schema.user.id, schema.characters.ownerUserId))
        .where(eq(schema.campaignCharacters.campaignId, campaignId))
        .orderBy(asc(schema.campaignCharacters.submittedAt))
    },

    /** Takes a pending or approved character off the roster, keeping the row as history (issue #22). */
    async retireCharacter(campaignId: string, characterId: string): Promise<boolean> {
      const rows = await db
        .update(schema.campaignCharacters)
        .set({ status: 'retired' })
        .where(
          and(
            eq(schema.campaignCharacters.campaignId, campaignId),
            eq(schema.campaignCharacters.characterId, characterId),
            inArray(schema.campaignCharacters.status, ['pending', 'approved']),
          ),
        )
        .returning({ characterId: schema.campaignCharacters.characterId })
      return rows.length > 0
    },

    /** Encounters of the campaign that still hold the character and are not completed. */
    async unfinishedEncountersWith(campaignId: string, characterId: string) {
      return db
        .select({
          id: schema.encounters.id,
          name: schema.encounters.name,
          status: schema.encounters.status,
        })
        .from(schema.encounterParticipants)
        .innerJoin(
          schema.encounters,
          eq(schema.encounters.id, schema.encounterParticipants.encounterId),
        )
        .where(
          and(
            eq(schema.encounters.campaignId, campaignId),
            eq(schema.encounterParticipants.characterId, characterId),
            ne(schema.encounters.status, 'completed'),
          ),
        )
    },

    /** The campaign a character is approved in, with its DM, for DM permissions on the sheet. */
    async approvedCampaignOf(
      executor: Executor,
      characterId: string,
    ): Promise<{ campaignId: string; dmUserId: string } | null> {
      const [row] = await executor
        .select({ campaignId: schema.campaigns.id, dmUserId: schema.campaigns.dmUserId })
        .from(schema.campaignCharacters)
        .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignCharacters.campaignId))
        .where(
          and(
            eq(schema.campaignCharacters.characterId, characterId),
            eq(schema.campaignCharacters.status, 'approved'),
          ),
        )
        .limit(1)
      return row ?? null
    },

    async shareSource(values: {
      campaignId: string
      sourceId: string
      enabled: boolean
      sharedBy: string
    }): Promise<void> {
      await db
        .insert(schema.campaignContentSources)
        .values(values)
        .onConflictDoUpdate({
          target: [
            schema.campaignContentSources.campaignId,
            schema.campaignContentSources.sourceId,
          ],
          set: { enabled: values.enabled },
        })
    },

    async sharedSources(campaignId: string) {
      return db
        .select({
          sourceId: schema.contentSources.id,
          slug: schema.contentSources.slug,
          name: schema.contentSources.name,
          ownerUserId: schema.contentSources.ownerUserId,
          enabled: schema.campaignContentSources.enabled,
        })
        .from(schema.campaignContentSources)
        .innerJoin(
          schema.contentSources,
          eq(schema.contentSources.id, schema.campaignContentSources.sourceId),
        )
        .where(eq(schema.campaignContentSources.campaignId, campaignId))
        .orderBy(asc(schema.contentSources.name))
    },

    async listEncounters(campaignId: string) {
      return db
        .select({
          id: schema.encounters.id,
          name: schema.encounters.name,
          status: schema.encounters.status,
          round: schema.encounters.round,
          version: schema.encounters.version,
          updatedAt: schema.encounters.updatedAt,
        })
        .from(schema.encounters)
        .where(eq(schema.encounters.campaignId, campaignId))
        .orderBy(desc(schema.encounters.updatedAt))
    },

    /** Visibility of a source through campaign sharing: any active member of a campaign it is shared with. */
    sharedWithUserCondition(userId: string) {
      return or(
        sql`${schema.contentSources.id} in (select ${schema.campaignContentSources.sourceId} from ${schema.campaignContentSources} join ${schema.campaignMembers} on ${schema.campaignMembers.campaignId} = ${schema.campaignContentSources.campaignId} where ${schema.campaignMembers.userId} = ${userId} and ${schema.campaignMembers.status} = 'active' and ${schema.campaignContentSources.enabled})`,
      )
    },
  }
}

export type CampaignRepo = ReturnType<typeof createCampaignRepo>
