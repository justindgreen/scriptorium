/** Rulesets and content (docs/DATA_MODEL.md §2). Versions are immutable; characters pin them. */
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'

export const rulesets = pgTable('rulesets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  edition: text('edition').notNull(),
  config: jsonb('config').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const contentSources = pgTable('content_sources', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // srd | user_import | homebrew
  license: text('license').notNull(),
  attributionText: text('attribution_text').notNull(),
  version: text('version').notNull(),
  publisher: text('publisher'),
  url: text('url'),
  description: text('description'),
  ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
  visibility: text('visibility').notNull().default('global'), // global | private | shared
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const contentEntries = pgTable(
  'content_entries',
  {
    id: uuid('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => contentSources.id, { onDelete: 'cascade' }),
    rulesetId: text('ruleset_id')
      .notNull()
      .references(() => rulesets.id),
    kind: text('kind').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('published'), // draft | published | archived
    /** Points into content_versions; no FK to avoid a circular constraint, maintained by the import/publish services. */
    headVersionId: uuid('head_version_id'),
    draftVersionId: uuid('draft_version_id'),
    /** Name, tags and a description excerpt; indexed for full-text and trigram search. */
    searchText: text('search_text').notNull().default(''),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('content_entries_source_kind_idx').on(t.sourceId, t.kind),
    index('content_entries_kind_name_idx').on(t.kind, t.name),
    index('content_entries_search_idx').using('gin', sql`to_tsvector('english', ${t.searchText})`),
    index('content_entries_name_trgm_idx').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
)

export const contentVersions = pgTable(
  'content_versions',
  {
    id: uuid('id').primaryKey(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => contentEntries.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    data: jsonb('data').notNull(),
    effects: jsonb('effects').notNull().default([]),
    choices: jsonb('choices').notNull().default([]),
    automation: jsonb('automation'),
    tests: jsonb('tests').notNull().default([]),
    changeNote: text('change_note'),
    checksum: text('checksum').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('content_versions_entry_version_idx').on(t.entryId, t.versionNo)],
)

export const contentRelations = pgTable(
  'content_relations',
  {
    fromEntryId: uuid('from_entry_id')
      .notNull()
      .references(() => contentEntries.id, { onDelete: 'cascade' }),
    /** Target by uid so relations can point at entries imported later. */
    toUid: text('to_uid').notNull(),
    relation: text('relation').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromEntryId, t.toUid, t.relation] }),
    index('content_relations_to_uid_idx').on(t.toUid),
  ],
)

export const contentTags = pgTable(
  'content_tags',
  {
    entryId: uuid('entry_id')
      .notNull()
      .references(() => contentEntries.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.tag] }), index('content_tags_tag_idx').on(t.tag)],
)

export const spellIndex = pgTable(
  'spell_index',
  {
    entryId: uuid('entry_id')
      .primaryKey()
      .references(() => contentEntries.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    school: text('school').notNull(),
    castingTimeType: text('casting_time_type').notNull(),
    ritual: boolean('ritual').notNull(),
    concentration: boolean('concentration').notNull(),
    classUids: text('class_uids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    index('spell_index_level_idx').on(t.level),
    index('spell_index_class_uids_idx').using('gin', t.classUids),
  ],
)

export const itemIndex = pgTable(
  'item_index',
  {
    entryId: uuid('entry_id')
      .primaryKey()
      .references(() => contentEntries.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    rarity: text('rarity'),
    requiresAttunement: boolean('requires_attunement').notNull().default(false),
    magic: boolean('magic').notNull().default(false),
    costCp: integer('cost_cp'),
    weight: real('weight'),
    weaponCategory: text('weapon_category'),
    armorCategory: text('armor_category'),
  },
  (t) => [
    index('item_index_category_idx').on(t.category),
    index('item_index_rarity_idx').on(t.rarity),
  ],
)

export const monsterIndex = pgTable(
  'monster_index',
  {
    entryId: uuid('entry_id')
      .primaryKey()
      .references(() => contentEntries.id, { onDelete: 'cascade' }),
    challengeRating: real('challenge_rating').notNull(),
    type: text('type').notNull(),
    size: text('size').notNull(),
    alignment: text('alignment').notNull(),
  },
  (t) => [
    index('monster_index_cr_idx').on(t.challengeRating),
    index('monster_index_type_idx').on(t.type),
  ],
)

export type ContentSourceRow = typeof contentSources.$inferSelect
export type ContentEntryRow = typeof contentEntries.$inferSelect
export type ContentVersionRow = typeof contentVersions.$inferSelect
