/** Characters: one aggregate, one revision (docs/DATA_MODEL.md §3). */
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'
import { contentEntries, contentVersions } from './content.js'

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id'),
    rulesetId: text('ruleset_id').notNull(),
    name: text('name').notNull(),
    portraitFileId: uuid('portrait_file_id'),
    biography: jsonb('biography')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The definition minus classes, items, spells, overrides and choices (which have rows). */
    abilityMethod: text('ability_method').notNull().default('standard'),
    baseAbilities: jsonb('base_abilities').notNull(),
    speciesUid: text('species_uid'),
    backgroundUid: text('background_uid'),
    xp: integer('xp').notNull().default(0),
    hpMode: text('hp_mode').notNull().default('fixed'),
    status: text('status').notNull().default('draft'), // draft | active | retired | dead
    revision: integer('revision').notNull().default(0),
    summary: jsonb('summary')
      .notNull()
      .default(sql`'{}'::jsonb`),
    schemaVersion: integer('schema_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('characters_owner_idx').on(t.ownerUserId),
    index('characters_campaign_idx').on(t.campaignId),
  ],
)

export const characterClasses = pgTable(
  'character_classes',
  {
    id: uuid('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    classUid: text('class_uid').notNull(),
    subclassUid: text('subclass_uid'),
    level: integer('level').notNull(),
    order: integer('order').notNull(),
    hitDiceRolls: jsonb('hit_dice_rolls')
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [uniqueIndex('character_classes_unique').on(t.characterId, t.classUid)],
)

export const characterChoices = pgTable(
  'character_choices',
  {
    id: uuid('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    choiceKey: text('choice_key').notNull(),
    selected: jsonb('selected').notNull(),
  },
  (t) => [uniqueIndex('character_choices_unique').on(t.characterId, t.choiceKey)],
)

export const characterItems = pgTable(
  'character_items',
  {
    id: text('id').notNull(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    itemUid: text('item_uid'),
    customItem: jsonb('custom_item'),
    quantity: integer('quantity').notNull().default(1),
    equipped: boolean('equipped').notNull().default(false),
    attuned: boolean('attuned').notNull().default(false),
    chargesCurrent: integer('charges_current'),
    containerItemId: text('container_item_id'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.id] })],
)

export const characterSpells = pgTable(
  'character_spells',
  {
    id: uuid('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    spellUid: text('spell_uid').notNull(),
    origin: text('origin').notNull(),
    known: boolean('known').notNull().default(true),
    prepared: boolean('prepared').notNull().default(false),
    alwaysPrepared: boolean('always_prepared').notNull().default(false),
  },
  (t) => [uniqueIndex('character_spells_unique').on(t.characterId, t.spellUid, t.origin)],
)

export const characterOverrides = pgTable(
  'character_overrides',
  {
    id: uuid('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    statPath: text('stat_path').notNull(),
    value: jsonb('value').notNull(),
    note: text('note'),
  },
  (t) => [uniqueIndex('character_overrides_unique').on(t.characterId, t.statPath)],
)

export const characterState = pgTable('character_state', {
  characterId: uuid('character_id')
    .primaryKey()
    .references(() => characters.id, { onDelete: 'cascade' }),
  hpCurrent: integer('hp_current').notNull().default(0),
  hpTemp: integer('hp_temp').notNull().default(0),
  deathSaves: jsonb('death_saves')
    .notNull()
    .default(sql`'{"successes":0,"failures":0}'::jsonb`),
  hitDiceSpent: jsonb('hit_dice_spent')
    .notNull()
    .default(sql`'{}'::jsonb`),
  spellSlotsUsed: jsonb('spell_slots_used')
    .notNull()
    .default(sql`'{}'::jsonb`),
  pactSlotsUsed: integer('pact_slots_used').notNull().default(0),
  resources: jsonb('resources')
    .notNull()
    .default(sql`'{}'::jsonb`),
  conditions: jsonb('conditions')
    .notNull()
    .default(sql`'[]'::jsonb`),
  exhaustion: integer('exhaustion').notNull().default(0),
  concentration: jsonb('concentration'),
  inspiration: boolean('inspiration').notNull().default(false),
  currency: jsonb('currency')
    .notNull()
    .default(sql`'{"cp":0,"sp":0,"ep":0,"gp":0,"pp":0}'::jsonb`),
  activeEffects: jsonb('active_effects')
    .notNull()
    .default(sql`'[]'::jsonb`),
  toggles: jsonb('toggles')
    .notNull()
    .default(sql`'{}'::jsonb`),
  combat: jsonb('combat').notNull(),
  assumptions: jsonb('assumptions')
    .notNull()
    .default(sql`'{}'::jsonb`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const characterEvents = pgTable(
  'character_events',
  {
    id: uuid('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    commandType: text('command_type').notNull(),
    payload: jsonb('payload').notNull(),
    before: jsonb('before').notNull(),
    after: jsonb('after').notNull(),
    summary: text('summary').notNull().default(''),
    revisionAfter: integer('revision_after').notNull(),
    reversible: boolean('reversible').notNull().default(false),
    actionId: uuid('action_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('character_events_character_idx').on(t.characterId, t.revisionAfter)],
)

export const characterSnapshots = pgTable(
  'character_snapshots',
  {
    id: uuid('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    reason: text('reason').notNull(), // level_up | rest | import | content_update | manual
    aggregate: jsonb('aggregate').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('character_snapshots_character_idx').on(t.characterId, t.revision)],
)

export const characterContentRefs = pgTable(
  'character_content_refs',
  {
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => contentEntries.id, { onDelete: 'restrict' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => contentVersions.id, { onDelete: 'restrict' }),
    refPath: text('ref_path').notNull(),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.versionId, t.refPath] })],
)

export const commandReceipts = pgTable(
  'command_receipts',
  {
    commandId: uuid('command_id').primaryKey(),
    actorUserId: text('actor_user_id'),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    outcome: jsonb('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('command_receipts_created_idx').on(t.createdAt)],
)

export const rolls = pgTable('rolls', {
  id: uuid('id').primaryKey(),
  requestedBy: text('requested_by').references(() => user.id, { onDelete: 'set null' }),
  context: jsonb('context').notNull(),
  expression: text('expression').notNull(),
  results: jsonb('results').notNull(),
  consumedByCommandId: uuid('consumed_by_command_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
