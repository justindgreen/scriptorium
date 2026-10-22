import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { ContentKind } from '@scriptorium/content-schema'
import type { Db } from '../../db/client.js'
import type { Scope } from '../../core/policy.js'
import { schema } from '../../db/client.js'

export type EntryListFilters = {
  kind?: ContentKind
  sourceSlugs?: string[]
  q?: string
  tags?: string[]
  includeDisabledSources?: boolean
  limit: number
  offset: number
}

/** Who is reading: global sources are visible to all, private ones to their owner and administrators. */
export type Viewer = Pick<Scope, 'userId' | 'role'>

/** Read access to published content. Campaign sharing narrows this further (M2.8). */
export function createContentRepo(db: Db) {
  const enabledOnly = eq(schema.contentSources.isEnabled, true)
  const visibleTo = (viewer: Viewer | undefined): SQL => {
    if (viewer?.role === 'admin') return sql`true`
    const global = eq(schema.contentSources.visibility, 'global')
    return viewer?.userId
      ? or(global, eq(schema.contentSources.ownerUserId, viewer.userId))!
      : global
  }

  return {
    async listSources() {
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
          kind: schema.contentSources.kind,
          license: schema.contentSources.license,
          attributionText: schema.contentSources.attributionText,
          version: schema.contentSources.version,
          publisher: schema.contentSources.publisher,
          url: schema.contentSources.url,
          description: schema.contentSources.description,
          isEnabled: schema.contentSources.isEnabled,
          entryCount: sql<number>`coalesce(${counts.n}, 0)::int`,
          updatedAt: schema.contentSources.updatedAt,
        })
        .from(schema.contentSources)
        .leftJoin(counts, eq(counts.sourceId, schema.contentSources.id))
        .orderBy(asc(schema.contentSources.name))
    },

    async listRulesets() {
      return db
        .select({
          id: schema.rulesets.id,
          name: schema.rulesets.name,
          version: schema.rulesets.version,
          edition: schema.rulesets.edition,
        })
        .from(schema.rulesets)
        .orderBy(asc(schema.rulesets.id))
    },

    async getRulesetConfig(id: string) {
      const [row] = await db
        .select({ config: schema.rulesets.config })
        .from(schema.rulesets)
        .where(eq(schema.rulesets.id, id))
        .limit(1)
      return row?.config ?? null
    },

    async listEntries(filters: EntryListFilters, viewer?: Viewer) {
      const conditions: SQL[] = [
        isNull(schema.contentEntries.deletedAt),
        eq(schema.contentEntries.status, 'published'),
        visibleTo(viewer),
      ]
      if (!filters.includeDisabledSources) conditions.push(enabledOnly)
      if (filters.kind) conditions.push(eq(schema.contentEntries.kind, filters.kind))
      if (filters.sourceSlugs?.length)
        conditions.push(inArray(schema.contentSources.slug, filters.sourceSlugs))
      if (filters.tags?.length) {
        conditions.push(
          sql`${schema.contentEntries.id} in (select ${schema.contentTags.entryId} from ${schema.contentTags} where ${inArray(schema.contentTags.tag, filters.tags)})`,
        )
      }
      const q = filters.q?.trim()
      let rank: SQL<number> | null = null
      if (q) {
        const tsQuery = sql`plainto_tsquery('english', ${q})`
        rank = sql<number>`greatest(ts_rank(to_tsvector('english', ${schema.contentEntries.searchText}), ${tsQuery}), similarity(${schema.contentEntries.name}, ${q}))`
        conditions.push(
          or(
            sql`to_tsvector('english', ${schema.contentEntries.searchText}) @@ ${tsQuery}`,
            sql`similarity(${schema.contentEntries.name}, ${q}) > 0.3`,
            ilike(schema.contentEntries.name, `%${q}%`),
          )!,
        )
      }
      const where = and(...conditions)
      const rows = await db
        .select({
          uid: schema.contentEntries.uid,
          kind: schema.contentEntries.kind,
          name: schema.contentEntries.name,
          sourceSlug: schema.contentSources.slug,
          sourceName: schema.contentSources.name,
          updatedAt: schema.contentEntries.updatedAt,
          spell: {
            level: schema.spellIndex.level,
            school: schema.spellIndex.school,
            ritual: schema.spellIndex.ritual,
            concentration: schema.spellIndex.concentration,
          },
          item: {
            category: schema.itemIndex.category,
            rarity: schema.itemIndex.rarity,
            magic: schema.itemIndex.magic,
            requiresAttunement: schema.itemIndex.requiresAttunement,
          },
          monster: {
            challengeRating: schema.monsterIndex.challengeRating,
            type: schema.monsterIndex.type,
            size: schema.monsterIndex.size,
          },
        })
        .from(schema.contentEntries)
        .innerJoin(
          schema.contentSources,
          eq(schema.contentSources.id, schema.contentEntries.sourceId),
        )
        .leftJoin(schema.spellIndex, eq(schema.spellIndex.entryId, schema.contentEntries.id))
        .leftJoin(schema.itemIndex, eq(schema.itemIndex.entryId, schema.contentEntries.id))
        .leftJoin(schema.monsterIndex, eq(schema.monsterIndex.entryId, schema.contentEntries.id))
        .where(where)
        .orderBy(
          ...(rank
            ? [desc(rank), asc(schema.contentEntries.name)]
            : [asc(schema.contentEntries.name)]),
        )
        .limit(filters.limit)
        .offset(filters.offset)
      const [total] = await db
        .select({ n: count() })
        .from(schema.contentEntries)
        .innerJoin(
          schema.contentSources,
          eq(schema.contentSources.id, schema.contentEntries.sourceId),
        )
        .where(where)
      return { items: rows, total: total?.n ?? 0 }
    },

    async getEntry(
      uid: string,
      options: { includeDisabledSources?: boolean; viewer?: Viewer } = {},
    ) {
      const conditions: SQL[] = [
        eq(schema.contentEntries.uid, uid),
        isNull(schema.contentEntries.deletedAt),
        visibleTo(options.viewer),
      ]
      if (!options.includeDisabledSources) conditions.push(enabledOnly)
      const [row] = await db
        .select({
          id: schema.contentEntries.id,
          uid: schema.contentEntries.uid,
          kind: schema.contentEntries.kind,
          slug: schema.contentEntries.slug,
          name: schema.contentEntries.name,
          rulesetId: schema.contentEntries.rulesetId,
          status: schema.contentEntries.status,
          source: {
            slug: schema.contentSources.slug,
            name: schema.contentSources.name,
            license: schema.contentSources.license,
          },
          version: {
            id: schema.contentVersions.id,
            versionNo: schema.contentVersions.versionNo,
            data: schema.contentVersions.data,
            effects: schema.contentVersions.effects,
            choices: schema.contentVersions.choices,
            automation: schema.contentVersions.automation,
            tests: schema.contentVersions.tests,
            checksum: schema.contentVersions.checksum,
            createdAt: schema.contentVersions.createdAt,
          },
          updatedAt: schema.contentEntries.updatedAt,
        })
        .from(schema.contentEntries)
        .innerJoin(
          schema.contentSources,
          eq(schema.contentSources.id, schema.contentEntries.sourceId),
        )
        .innerJoin(
          schema.contentVersions,
          eq(schema.contentVersions.id, schema.contentEntries.headVersionId),
        )
        .where(and(...conditions))
        .limit(1)
      if (!row) return null
      const tags = await db
        .select({ tag: schema.contentTags.tag })
        .from(schema.contentTags)
        .where(eq(schema.contentTags.entryId, row.id))
      const relations = await db
        .select({
          toUid: schema.contentRelations.toUid,
          relation: schema.contentRelations.relation,
        })
        .from(schema.contentRelations)
        .where(eq(schema.contentRelations.fromEntryId, row.id))
      return { ...row, tags: tags.map((t) => t.tag), relations }
    },

    async countByKind(sourceSlug?: string) {
      const conditions: SQL[] = [isNull(schema.contentEntries.deletedAt)]
      if (sourceSlug) conditions.push(eq(schema.contentSources.slug, sourceSlug))
      return db
        .select({ kind: schema.contentEntries.kind, n: count() })
        .from(schema.contentEntries)
        .innerJoin(
          schema.contentSources,
          eq(schema.contentSources.id, schema.contentEntries.sourceId),
        )
        .where(and(...conditions))
        .groupBy(schema.contentEntries.kind)
        .orderBy(asc(schema.contentEntries.kind))
    },

    async setSourceEnabled(id: string, enabled: boolean) {
      const rows = await db
        .update(schema.contentSources)
        .set({ isEnabled: enabled, updatedAt: sql`now()` })
        .where(eq(schema.contentSources.id, id))
        .returning({ id: schema.contentSources.id })
      return rows.length > 0
    },
  }
}

export type ContentRepo = ReturnType<typeof createContentRepo>
