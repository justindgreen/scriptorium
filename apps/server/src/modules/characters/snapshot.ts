/**
 * Content snapshot loader (docs/RULES_ENGINE.md §1): the pinned content_versions a character
 * references plus their transitive references, resolved from the database.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { contentEntrySchema, type ContentEntry } from '@scriptorium/content-schema'
import { createSnapshot, type ContentSnapshot } from '@scriptorium/rules-engine'
import { schema, type Db } from '../../db/client.js'

export type ContentRef = { uid: string; entryId: string; versionId: string }

export type LoadedSnapshot = { snapshot: ContentSnapshot; refs: ContentRef[] }

const UID =
  /^[a-z0-9]+(?:[-.][a-z0-9]+)*:(class|subclass|species|background|feat|feature|spell|spell_list|item|monster|condition|rule|resource):[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Kinds whose references are not followed (a spell list would pull in every spell on it). */
const LEAF_KINDS = new Set(['spell', 'spell_list', 'monster', 'rule', 'condition', 'resource'])

type Tx = Pick<Db, 'select'>

function collectUids(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (UID.test(value)) out.add(value)
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectUids(v, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectUids(v, out)
  }
}

type Row = {
  entryId: string
  versionId: string
  uid: string
  kind: string
  slug: string
  name: string
  data: unknown
  effects: unknown
  choices: unknown
  automation: unknown
  tests: unknown
}

async function loadRows(tx: Tx, uids: string[], pinned: Map<string, string>): Promise<Row[]> {
  if (uids.length === 0) return []
  const pinnedIds = uids.map((u) => pinned.get(u)).filter((v): v is string => Boolean(v))
  const unpinned = uids.filter((u) => !pinned.has(u))
  const rows: Row[] = []
  if (pinnedIds.length > 0) {
    const found = await tx
      .select({
        entryId: schema.contentEntries.id,
        versionId: schema.contentVersions.id,
        uid: schema.contentEntries.uid,
        kind: schema.contentEntries.kind,
        slug: schema.contentEntries.slug,
        name: schema.contentEntries.name,
        data: schema.contentVersions.data,
        effects: schema.contentVersions.effects,
        choices: schema.contentVersions.choices,
        automation: schema.contentVersions.automation,
        tests: schema.contentVersions.tests,
      })
      .from(schema.contentVersions)
      .innerJoin(
        schema.contentEntries,
        eq(schema.contentEntries.id, schema.contentVersions.entryId),
      )
      .where(inArray(schema.contentVersions.id, pinnedIds))
    rows.push(...found)
  }
  const stillMissing = [
    ...unpinned,
    ...uids.filter((u) => pinned.has(u) && !rows.some((r) => r.uid === u)),
  ]
  if (stillMissing.length > 0) {
    const found = await tx
      .select({
        entryId: schema.contentEntries.id,
        versionId: schema.contentVersions.id,
        uid: schema.contentEntries.uid,
        kind: schema.contentEntries.kind,
        slug: schema.contentEntries.slug,
        name: schema.contentEntries.name,
        data: schema.contentVersions.data,
        effects: schema.contentVersions.effects,
        choices: schema.contentVersions.choices,
        automation: schema.contentVersions.automation,
        tests: schema.contentVersions.tests,
      })
      .from(schema.contentEntries)
      .innerJoin(
        schema.contentVersions,
        eq(schema.contentVersions.id, schema.contentEntries.headVersionId),
      )
      .where(
        and(
          inArray(schema.contentEntries.uid, stillMissing),
          isNull(schema.contentEntries.deletedAt),
        ),
      )
    rows.push(...found)
  }
  return rows
}

async function loadTags(tx: Tx, entryIds: string[]): Promise<Map<string, string[]>> {
  const tags = new Map<string, string[]>()
  if (entryIds.length === 0) return tags
  const rows = await tx
    .select({ entryId: schema.contentTags.entryId, tag: schema.contentTags.tag })
    .from(schema.contentTags)
    .where(inArray(schema.contentTags.entryId, entryIds))
  for (const row of rows) tags.set(row.entryId, [...(tags.get(row.entryId) ?? []), row.tag])
  return tags
}

/**
 * Loads `roots` and everything they reference (classes pull their features and subclass features,
 * species their parents and traits, features the features and spells they grant, items their
 * variants). Pinned uids load the pinned version; the rest load the head version.
 */
export async function loadSnapshot(
  tx: Tx,
  roots: Iterable<string>,
  pinned: Map<string, string> = new Map(),
): Promise<LoadedSnapshot> {
  const entries = new Map<string, ContentEntry>()
  const refs: ContentRef[] = []
  let frontier = [...new Set([...roots].filter((u) => UID.test(u)))]
  let rounds = 0
  while (frontier.length > 0 && rounds < 12) {
    rounds += 1
    const rows = await loadRows(tx, frontier, pinned)
    const tags = await loadTags(
      tx,
      rows.map((r) => r.entryId),
    )
    const next = new Set<string>()
    for (const row of rows) {
      if (entries.has(row.uid)) continue
      const parsed = contentEntrySchema.safeParse({
        kind: row.kind,
        uid: row.uid,
        slug: row.slug,
        name: row.name,
        data: row.data,
        effects: row.effects,
        choices: row.choices,
        automation: row.automation ?? undefined,
        tests: row.tests,
        tags: tags.get(row.entryId) ?? [],
        relations: [],
      })
      if (!parsed.success) continue
      const entry = parsed.data
      entries.set(entry.uid, entry)
      refs.push({ uid: entry.uid, entryId: row.entryId, versionId: row.versionId })
      if (LEAF_KINDS.has(entry.kind)) continue
      const found = new Set<string>()
      collectUids(entry.data, found)
      collectUids(entry.effects, found)
      collectUids(entry.choices, found)
      for (const uid of found) if (!entries.has(uid)) next.add(uid)
    }
    frontier = [...next]
  }
  return { snapshot: createSnapshot(entries.values()), refs }
}

/** Every uid a character definition, inventory and state refer to. */
export function characterRootUids(
  aggregate: {
    definition: {
      speciesUid?: string
      backgroundUid?: string
      classes: Array<{ classUid: string; subclassUid?: string }>
      choices: Record<string, unknown>
      spells: Array<{ spellUid: string }>
    }
    inventory: Array<{ itemUid?: string }>
    state: { conditions: Array<{ uid: string }> }
  },
  extras: unknown[] = [],
): string[] {
  const roots = new Set<string>()
  // A command may introduce content the aggregate does not reference yet (a new item or class).
  for (const extra of extras) collectUids(extra, roots)
  const d = aggregate.definition
  if (d.speciesUid) roots.add(d.speciesUid)
  if (d.backgroundUid) roots.add(d.backgroundUid)
  for (const c of d.classes) {
    roots.add(c.classUid)
    if (c.subclassUid) roots.add(c.subclassUid)
  }
  collectUids(d.choices, roots)
  for (const s of d.spells) roots.add(s.spellUid)
  for (const i of aggregate.inventory) if (i.itemUid) roots.add(i.itemUid)
  for (const c of aggregate.state.conditions) roots.add(c.uid)
  return [...roots]
}
