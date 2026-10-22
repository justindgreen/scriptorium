/**
 * Homebrew rows: a user's sources and the entries in them, with draft and head versions
 * (docs/DATA_MODEL.md §2). Published versions are immutable; drafts are rewritten in place.
 */
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'
import type { ContentEntry } from '@scriptorium/content-schema'
import { schema, type Db } from '../../db/client.js'
import { newId } from '../../core/ids.js'
import { entryChecksum, impliedRelations, searchTextFor } from '../content/import.js'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type Executor = Db | Tx

export type VersionRow = {
  id: string
  versionNo: number
  data: unknown
  effects: unknown
  automation: unknown
  changeNote: string | null
  createdAt: Date
}

const versionColumns = {
  id: schema.contentVersions.id,
  versionNo: schema.contentVersions.versionNo,
  data: schema.contentVersions.data,
  effects: schema.contentVersions.effects,
  automation: schema.contentVersions.automation,
  changeNote: schema.contentVersions.changeNote,
  createdAt: schema.contentVersions.createdAt,
}

function tagsFor(entry: ContentEntry): string[] {
  if (entry.kind !== 'item') return ['homebrew']
  const tags = new Set<string>(['homebrew', entry.data.category])
  if (entry.data.magic) tags.add('magic')
  if (entry.data.rarity) tags.add(entry.data.rarity)
  if (entry.data.weapon) tags.add(entry.data.weapon.category)
  return [...tags]
}

export function createHomebrewRepo(db: Db) {
  async function versionById(executor: Executor, id: string | null): Promise<VersionRow | null> {
    if (!id) return null
    const [row] = await executor
      .select(versionColumns)
      .from(schema.contentVersions)
      .where(eq(schema.contentVersions.id, id))
      .limit(1)
    return row ?? null
  }

  return {
    async listSources(ownerUserId: string) {
      const counts = db
        .select({ sourceId: schema.contentEntries.sourceId, n: count().as('n') })
        .from(schema.contentEntries)
        .where(isNull(schema.contentEntries.deletedAt))
        .groupBy(schema.contentEntries.sourceId)
        .as('counts')
      return db
        .select({
          id: schema.contentSources.id,
          slug: schema.contentSources.slug,
          name: schema.contentSources.name,
          description: schema.contentSources.description,
          visibility: schema.contentSources.visibility,
          entryCount: sql<number>`coalesce(${counts.n}, 0)::int`,
          createdAt: schema.contentSources.createdAt,
        })
        .from(schema.contentSources)
        .leftJoin(counts, eq(counts.sourceId, schema.contentSources.id))
        .where(
          and(
            eq(schema.contentSources.kind, 'homebrew'),
            eq(schema.contentSources.ownerUserId, ownerUserId),
          ),
        )
        .orderBy(asc(schema.contentSources.createdAt))
    },

    async getSource(id: string) {
      const [row] = await db
        .select({
          id: schema.contentSources.id,
          slug: schema.contentSources.slug,
          name: schema.contentSources.name,
          kind: schema.contentSources.kind,
          ownerUserId: schema.contentSources.ownerUserId,
          visibility: schema.contentSources.visibility,
        })
        .from(schema.contentSources)
        .where(eq(schema.contentSources.id, id))
        .limit(1)
      return row ?? null
    },

    async slugTaken(slug: string) {
      const [row] = await db
        .select({ id: schema.contentSources.id })
        .from(schema.contentSources)
        .where(eq(schema.contentSources.slug, slug))
        .limit(1)
      return Boolean(row)
    },

    async createSource(values: {
      ownerUserId: string
      slug: string
      name: string
      attributionText: string
      description?: string
    }) {
      const id = newId()
      await db.insert(schema.contentSources).values({
        id,
        slug: values.slug,
        name: values.name,
        kind: 'homebrew',
        license: 'Homebrew (all rights reserved by the author)',
        attributionText: values.attributionText,
        version: '1',
        description: values.description ?? null,
        ownerUserId: values.ownerUserId,
        visibility: 'private',
      })
      return id
    },

    async listItems(ownerUserId: string) {
      const head = db
        .select({ id: schema.contentVersions.id, versionNo: schema.contentVersions.versionNo })
        .from(schema.contentVersions)
        .as('head')
      return db
        .select({
          id: schema.contentEntries.id,
          uid: schema.contentEntries.uid,
          name: schema.contentEntries.name,
          status: schema.contentEntries.status,
          sourceId: schema.contentSources.id,
          sourceName: schema.contentSources.name,
          headVersionId: schema.contentEntries.headVersionId,
          draftVersionId: schema.contentEntries.draftVersionId,
          headVersionNo: head.versionNo,
          updatedAt: schema.contentEntries.updatedAt,
        })
        .from(schema.contentEntries)
        .innerJoin(
          schema.contentSources,
          eq(schema.contentSources.id, schema.contentEntries.sourceId),
        )
        .leftJoin(head, eq(head.id, schema.contentEntries.headVersionId))
        .where(
          and(
            eq(schema.contentSources.kind, 'homebrew'),
            eq(schema.contentSources.ownerUserId, ownerUserId),
            eq(schema.contentEntries.kind, 'item'),
            isNull(schema.contentEntries.deletedAt),
          ),
        )
        .orderBy(desc(schema.contentEntries.updatedAt))
    },

    async getItem(entryId: string) {
      const [row] = await db
        .select({
          id: schema.contentEntries.id,
          uid: schema.contentEntries.uid,
          slug: schema.contentEntries.slug,
          name: schema.contentEntries.name,
          kind: schema.contentEntries.kind,
          rulesetId: schema.contentEntries.rulesetId,
          status: schema.contentEntries.status,
          headVersionId: schema.contentEntries.headVersionId,
          draftVersionId: schema.contentEntries.draftVersionId,
          updatedAt: schema.contentEntries.updatedAt,
          source: {
            id: schema.contentSources.id,
            slug: schema.contentSources.slug,
            name: schema.contentSources.name,
            ownerUserId: schema.contentSources.ownerUserId,
          },
        })
        .from(schema.contentEntries)
        .innerJoin(
          schema.contentSources,
          eq(schema.contentSources.id, schema.contentEntries.sourceId),
        )
        .where(and(eq(schema.contentEntries.id, entryId), isNull(schema.contentEntries.deletedAt)))
        .limit(1)
      if (!row) return null
      const [draft, head] = await Promise.all([
        versionById(db, row.draftVersionId),
        versionById(db, row.headVersionId),
      ])
      return { ...row, draft, head }
    },

    async uidTaken(uid: string) {
      const [row] = await db
        .select({ id: schema.contentEntries.id })
        .from(schema.contentEntries)
        .where(eq(schema.contentEntries.uid, uid))
        .limit(1)
      return Boolean(row)
    },

    /** A new entry whose first version is a draft; nothing is published yet. */
    async createDraftEntry(values: {
      sourceId: string
      rulesetId: string
      entry: ContentEntry
      createdBy: string
      changeNote?: string
    }) {
      const entryId = newId()
      const versionId = newId()
      await db.transaction(async (tx) => {
        await tx.insert(schema.contentEntries).values({
          id: entryId,
          uid: values.entry.uid,
          sourceId: values.sourceId,
          rulesetId: values.rulesetId,
          kind: values.entry.kind,
          slug: values.entry.slug,
          name: values.entry.name,
          status: 'draft',
          draftVersionId: versionId,
          searchText: searchTextFor(values.entry),
          createdBy: values.createdBy,
        })
        await tx.insert(schema.contentVersions).values({
          id: versionId,
          entryId,
          versionNo: 1,
          data: values.entry.data,
          effects: values.entry.effects,
          choices: values.entry.choices,
          automation: values.entry.automation ?? null,
          tests: values.entry.tests,
          checksum: entryChecksum(values.entry),
          changeNote: values.changeNote ?? null,
          createdBy: values.createdBy,
        })
      })
      return { entryId, versionId }
    },

    /** Rewrites the draft version (or opens one after the head) with the new content. */
    async saveDraft(values: {
      entryId: string
      draftVersionId: string | null
      headVersionNo: number
      entry: ContentEntry
      actorId: string
      changeNote?: string
    }) {
      return db.transaction(async (tx) => {
        const content = {
          data: values.entry.data,
          effects: values.entry.effects,
          choices: values.entry.choices,
          automation: values.entry.automation ?? null,
          tests: values.entry.tests,
          checksum: entryChecksum(values.entry),
          changeNote: values.changeNote ?? null,
        }
        let versionId = values.draftVersionId
        if (versionId) {
          await tx
            .update(schema.contentVersions)
            .set(content)
            .where(eq(schema.contentVersions.id, versionId))
        } else {
          versionId = newId()
          await tx.insert(schema.contentVersions).values({
            id: versionId,
            entryId: values.entryId,
            versionNo: values.headVersionNo + 1,
            ...content,
            createdBy: values.actorId,
          })
        }
        await tx
          .update(schema.contentEntries)
          .set({
            draftVersionId: versionId,
            name: values.entry.name,
            searchText: searchTextFor(values.entry),
            updatedAt: sql`now()`,
          })
          .where(eq(schema.contentEntries.id, values.entryId))
        return versionId
      })
    },

    /** The draft becomes the head version; projections, tags and relations follow it. */
    async publish(values: { entryId: string; draftVersionId: string; entry: ContentEntry }) {
      await db.transaction(async (tx) => {
        await tx
          .update(schema.contentEntries)
          .set({
            headVersionId: values.draftVersionId,
            draftVersionId: null,
            status: 'published',
            name: values.entry.name,
            searchText: searchTextFor(values.entry),
            updatedAt: sql`now()`,
          })
          .where(eq(schema.contentEntries.id, values.entryId))
        await tx.delete(schema.contentTags).where(eq(schema.contentTags.entryId, values.entryId))
        await tx
          .delete(schema.contentRelations)
          .where(eq(schema.contentRelations.fromEntryId, values.entryId))
        await tx.delete(schema.itemIndex).where(eq(schema.itemIndex.entryId, values.entryId))
        const tags = tagsFor(values.entry)
        if (tags.length > 0)
          await tx
            .insert(schema.contentTags)
            .values(tags.map((tag) => ({ entryId: values.entryId, tag })))
        const relations = impliedRelations(values.entry)
        if (relations.length > 0)
          await tx
            .insert(schema.contentRelations)
            .values(relations.map((r) => ({ fromEntryId: values.entryId, ...r })))
        if (values.entry.kind === 'item') {
          const data = values.entry.data
          await tx.insert(schema.itemIndex).values({
            entryId: values.entryId,
            category: data.category,
            rarity: data.rarity ?? null,
            requiresAttunement: data.requiresAttunement,
            magic: data.magic,
            costCp: null,
            weight: data.weight ?? null,
            weaponCategory: data.weapon?.category ?? null,
            armorCategory: data.armor?.category ?? null,
          })
        }
      })
    },

    /** Removes an entry that was never published (its versions cascade). */
    async deleteUnpublished(entryId: string) {
      const rows = await db
        .delete(schema.contentEntries)
        .where(
          and(eq(schema.contentEntries.id, entryId), isNull(schema.contentEntries.headVersionId)),
        )
        .returning({ id: schema.contentEntries.id })
      return rows.length > 0
    },
  }
}

export type HomebrewRepo = ReturnType<typeof createHomebrewRepo>
