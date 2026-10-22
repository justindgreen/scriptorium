/**
 * Campaigns and encounters (docs/DATA_MODEL.md §4–§5). An encounter is its own aggregate with a
 * `version`; a participant that is a player character stores no hit points of its own.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'
import { characters } from './characters.js'
import { contentSources } from './content.js'

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    descriptionMd: text('description_md').notNull().default(''),
    rulesetId: text('ruleset_id').notNull(),
    dmUserId: text('dm_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('active'), // active | archived
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_dm_idx').on(t.dmUserId)],
)

export const campaignMembers = pgTable(
  'campaign_members',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('player'), // dm | co_dm | player | observer
    status: text('status').notNull().default('active'), // invited | active | removed
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.userId] }),
    index('campaign_members_user_idx').on(t.userId),
  ],
)

export const campaignInvites = pgTable(
  'campaign_invites',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    /** SHA-256 of the join code; the plaintext is shown once at creation. */
    codeHash: text('code_hash').notNull().unique(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    maxUses: integer('max_uses').notNull().default(10),
    uses: integer('uses').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaign_invites_campaign_idx').on(t.campaignId)],
)

export const campaignCharacters = pgTable(
  'campaign_characters',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'), // pending | approved | retired
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    approvedBy: text('approved_by').references(() => user.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.characterId] }),
    index('campaign_characters_character_idx').on(t.characterId),
  ],
)

export const campaignContentSources = pgTable(
  'campaign_content_sources',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => contentSources.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    sharedBy: text('shared_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.sourceId] }),
    index('campaign_content_sources_source_idx').on(t.sourceId),
  ],
)

export const encounters = pgTable(
  'encounters',
  {
    id: uuid('id').primaryKey(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    descriptionMd: text('description_md').notNull().default(''),
    dmNotesMd: text('dm_notes_md').notNull().default(''),
    status: text('status').notNull().default('planned'), // planned | active | completed
    round: integer('round').notNull().default(0),
    turnIndex: integer('turn_index').notNull().default(0),
    currentTurnId: text('current_turn_id'),
    version: integer('version').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('encounters_campaign_idx').on(t.campaignId)],
)

export const encounterParticipants = pgTable(
  'encounter_participants',
  {
    id: uuid('id').primaryKey(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // monster | character
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'cascade' }),
    /** Monster content: the uid and the pinned version it was added with. */
    entryUid: text('entry_uid'),
    versionId: uuid('version_id'),
    displayName: text('display_name').notNull(),
    initiative: real('initiative'),
    tiebreak: real('tiebreak').notNull().default(0),
    /** Monsters only; characters keep hit points on their sheet. */
    hpCurrent: integer('hp_current'),
    hpMax: integer('hp_max'),
    hpTemp: integer('hp_temp').notNull().default(0),
    ac: integer('ac'),
    conditions: jsonb('conditions')
      .notNull()
      .default(sql`'[]'::jsonb`),
    combat: jsonb('combat')
      .notNull()
      .default(sql`'{}'::jsonb`),
    visibleToPlayers: boolean('visible_to_players').notNull().default(true),
    defeated: boolean('defeated').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('encounter_participants_encounter_idx').on(t.encounterId)],
)

export const encounterEvents = pgTable(
  'encounter_events',
  {
    id: uuid('id').primaryKey(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    actionId: uuid('action_id'),
    versionAfter: integer('version_after').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('encounter_events_encounter_idx').on(t.encounterId, t.versionAfter)],
)

export type CampaignRow = typeof campaigns.$inferSelect
export type EncounterRow = typeof encounters.$inferSelect
export type ParticipantRow = typeof encounterParticipants.$inferSelect
