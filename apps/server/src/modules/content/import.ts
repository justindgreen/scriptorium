import { createHash } from 'node:crypto'
import {
  parseContentPackage,
  rulesetConfigSchema,
  type ContentEntry,
  type ContentPackage,
  type RulesetConfig,
} from '@scriptorium/content-schema'
import { eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../../db/client.js'
import { schema } from '../../db/client.js'
import { newId } from '../../core/ids.js'

export type ImportCounts = { created: number; updated: number; unchanged: number }
export type ImportResult = {
  source: { id: string; slug: string; created: boolean }
  entries: ImportCounts
  total: number
}

export class ImportError extends Error {
  constructor(
    message: string,
    public readonly issues: Array<{ path: string; message: string }> = [],
  ) {
    super(message)
    this.name = 'ImportError'
  }
}

/** Stable JSON (sorted keys) so checksums do not depend on property order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function entryChecksum(entry: ContentEntry): string {
  const { data, effects, choices, automation, tests, tags, relations, name, reference } = entry
  return createHash('sha256')
    .update(
      stableStringify({
        data,
        effects,
        choices,
        automation: automation ?? null,
        tests,
        tags,
        relations,
        name,
        reference: reference ?? null,
      }),
    )
    .digest('hex')
}

function excerpt(value: unknown, max = 1500): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').slice(0, max)
}

function searchTextFor(entry: ContentEntry): string {
  const data = entry.data as Record<string, unknown>
  const description = excerpt(data['description'])
  const extra =
    entry.kind === 'monster'
      ? `${String(data['type'] ?? '')} ${String(data['alignment'] ?? '')}`
      : ''
  return [entry.name, entry.tags.join(' '), extra, description].filter(Boolean).join(' ')
}

/** Relations implied by the data, in addition to the explicit `relations` array. */
function impliedRelations(entry: ContentEntry): Array<{ toUid: string; relation: string }> {
  const out: Array<{ toUid: string; relation: string }> = []
  switch (entry.kind) {
    case 'subclass':
      out.push({ toUid: entry.data.class, relation: 'subclass_of' })
      break
    case 'species':
      if (entry.data.parent) out.push({ toUid: entry.data.parent, relation: 'variant_of' })
      for (const trait of entry.data.traits) out.push({ toUid: trait.uid, relation: 'grants' })
      break
    case 'spell':
      for (const cls of entry.data.classes) out.push({ toUid: cls, relation: 'list_member' })
      break
    case 'spell_list':
      for (const spell of entry.data.spells) out.push({ toUid: spell, relation: 'grants' })
      break
    case 'feature':
      if (entry.data.owner) out.push({ toUid: entry.data.owner, relation: 'owner_of' })
      break
    case 'class':
      for (const level of entry.data.levels)
        for (const f of level.features) out.push({ toUid: f, relation: 'grants' })
      break
    case 'item':
      if (entry.data.variantOf) out.push({ toUid: entry.data.variantOf, relation: 'variant_of' })
      break
    default:
      break
  }
  return out
}

function costInCopper(cost: { quantity: number; unit: string } | undefined): number | null {
  if (!cost) return null
  const rate: Record<string, number> = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 }
  return Math.round(cost.quantity * (rate[cost.unit] ?? 0))
}

/** Upserts a ruleset configuration (validated). Returns true when created or changed. */
export async function upsertRuleset(
  db: Db,
  input: unknown,
): Promise<{ id: string; changed: boolean }> {
  const parsed = rulesetConfigSchema.safeParse(input)
  if (!parsed.success) {
    throw new ImportError(
      'Invalid ruleset configuration',
      parsed.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
    )
  }
  const config: RulesetConfig = parsed.data
  const [existing] = await db
    .select({ config: schema.rulesets.config })
    .from(schema.rulesets)
    .where(eq(schema.rulesets.id, config.id))
    .limit(1)
  if (existing && stableStringify(existing.config) === stableStringify(config))
    return { id: config.id, changed: false }
  await db
    .insert(schema.rulesets)
    .values({
      id: config.id,
      name: config.name,
      version: config.version,
      edition: config.edition,
      config,
    })
    .onConflictDoUpdate({
      target: schema.rulesets.id,
      set: {
        name: config.name,
        version: config.version,
        edition: config.edition,
        config,
        updatedAt: sql`now()`,
      },
    })
  return { id: config.id, changed: true }
}

/**
 * Imports a content package idempotently: unchanged entries (by checksum) are skipped, changed
 * entries get a new immutable version and the head pointer moves, new entries are created.
 */
export async function importPackage(
  db: Db,
  input: unknown,
  options: { actorId?: string | null } = {},
): Promise<ImportResult> {
  const parsed = parseContentPackage(input)
  if (!parsed.ok) throw new ImportError('Invalid content package', parsed.issues)
  const pkg: ContentPackage = parsed.package

  return db.transaction(async (tx) => {
    const [ruleset] = await tx
      .select({ id: schema.rulesets.id })
      .from(schema.rulesets)
      .where(eq(schema.rulesets.id, pkg.rulesetId))
      .limit(1)
    if (!ruleset)
      throw new ImportError(`Unknown ruleset "${pkg.rulesetId}"; import its configuration first`)

    // Source
    const [existingSource] = await tx
      .select({ id: schema.contentSources.id })
      .from(schema.contentSources)
      .where(eq(schema.contentSources.slug, pkg.source.slug))
      .limit(1)
    const sourceId = existingSource?.id ?? newId()
    const sourceValues = {
      slug: pkg.source.slug,
      name: pkg.source.name,
      kind: pkg.source.kind,
      license: pkg.source.license,
      attributionText: pkg.source.attributionText,
      version: pkg.source.version,
      publisher: pkg.source.publisher ?? null,
      url: pkg.source.url ?? null,
      description: pkg.source.description ?? null,
    }
    if (existingSource) {
      await tx
        .update(schema.contentSources)
        .set({ ...sourceValues, updatedAt: sql`now()` })
        .where(eq(schema.contentSources.id, sourceId))
    } else {
      await tx
        .insert(schema.contentSources)
        .values({ id: sourceId, ...sourceValues, ownerUserId: options.actorId ?? null })
    }

    // Existing entries of this source with their head checksum
    const existing = await tx
      .select({
        id: schema.contentEntries.id,
        uid: schema.contentEntries.uid,
        headVersionId: schema.contentEntries.headVersionId,
        checksum: schema.contentVersions.checksum,
        versionNo: schema.contentVersions.versionNo,
      })
      .from(schema.contentEntries)
      .leftJoin(
        schema.contentVersions,
        eq(schema.contentVersions.id, schema.contentEntries.headVersionId),
      )
      .where(eq(schema.contentEntries.sourceId, sourceId))
    const byUid = new Map(existing.map((e) => [e.uid, e]))

    const counts: ImportCounts = { created: 0, updated: 0, unchanged: 0 }
    const touchedIds: string[] = []
    const tagRows: Array<{ entryId: string; tag: string }> = []
    const relationRows: Array<{ fromEntryId: string; toUid: string; relation: string }> = []
    const spellRows: (typeof schema.spellIndex.$inferInsert)[] = []
    const itemRows: (typeof schema.itemIndex.$inferInsert)[] = []
    const monsterRows: (typeof schema.monsterIndex.$inferInsert)[] = []

    for (const entry of pkg.entries) {
      const checksum = entryChecksum(entry)
      const current = byUid.get(entry.uid)
      if (current && current.checksum === checksum) {
        counts.unchanged += 1
        continue
      }
      const entryId = current?.id ?? newId()
      const versionId = newId()
      const versionNo = (current?.versionNo ?? 0) + 1
      const rulesetId = entry.rulesetId ?? pkg.rulesetId

      if (!current) {
        await tx.insert(schema.contentEntries).values({
          id: entryId,
          uid: entry.uid,
          sourceId,
          rulesetId,
          kind: entry.kind,
          slug: entry.slug,
          name: entry.name,
          status: 'published',
          searchText: searchTextFor(entry),
          createdBy: options.actorId ?? null,
        })
        counts.created += 1
      }
      await tx.insert(schema.contentVersions).values({
        id: versionId,
        entryId,
        versionNo,
        data: entry.data,
        effects: entry.effects,
        choices: entry.choices,
        automation: entry.automation ?? null,
        tests: entry.tests,
        checksum,
        changeNote: current ? `Imported ${pkg.source.slug}@${pkg.source.version}` : null,
        createdBy: options.actorId ?? null,
      })
      await tx
        .update(schema.contentEntries)
        .set({
          headVersionId: versionId,
          name: entry.name,
          rulesetId,
          searchText: searchTextFor(entry),
          status: 'published',
          deletedAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.contentEntries.id, entryId))
      if (current) counts.updated += 1

      touchedIds.push(entryId)
      for (const tag of entry.tags) tagRows.push({ entryId, tag })
      const relations = [
        ...entry.relations.map((r) => ({ toUid: r.to, relation: r.relation })),
        ...impliedRelations(entry),
      ]
      const seen = new Set<string>()
      for (const r of relations) {
        const key = `${r.toUid}|${r.relation}`
        if (seen.has(key)) continue
        seen.add(key)
        relationRows.push({ fromEntryId: entryId, ...r })
      }
      if (entry.kind === 'spell') {
        spellRows.push({
          entryId,
          level: entry.data.level,
          school: entry.data.school,
          castingTimeType: entry.data.castingTimeType,
          ritual: entry.data.ritual,
          concentration: entry.data.concentration,
          classUids: entry.data.classes,
        })
      } else if (entry.kind === 'item') {
        itemRows.push({
          entryId,
          category: entry.data.category,
          rarity: entry.data.rarity ?? null,
          requiresAttunement: entry.data.requiresAttunement,
          magic: entry.data.magic,
          costCp: costInCopper(entry.data.cost),
          weight: entry.data.weight ?? null,
          weaponCategory: entry.data.weapon?.category ?? null,
          armorCategory: entry.data.armor?.category ?? null,
        })
      } else if (entry.kind === 'monster') {
        monsterRows.push({
          entryId,
          challengeRating: entry.data.challengeRating,
          type: entry.data.type,
          size: entry.data.size,
          alignment: entry.data.alignment,
        })
      }
    }

    // Rebuild tags, relations and projections for touched entries, in batches.
    for (const ids of chunk(touchedIds, 500)) {
      await tx.delete(schema.contentTags).where(inArray(schema.contentTags.entryId, ids))
      await tx
        .delete(schema.contentRelations)
        .where(inArray(schema.contentRelations.fromEntryId, ids))
      await tx.delete(schema.spellIndex).where(inArray(schema.spellIndex.entryId, ids))
      await tx.delete(schema.itemIndex).where(inArray(schema.itemIndex.entryId, ids))
      await tx.delete(schema.monsterIndex).where(inArray(schema.monsterIndex.entryId, ids))
    }
    for (const rows of chunk(tagRows, 1000)) await tx.insert(schema.contentTags).values(rows)
    for (const rows of chunk(relationRows, 1000))
      await tx.insert(schema.contentRelations).values(rows)
    for (const rows of chunk(spellRows, 500)) await tx.insert(schema.spellIndex).values(rows)
    for (const rows of chunk(itemRows, 500)) await tx.insert(schema.itemIndex).values(rows)
    for (const rows of chunk(monsterRows, 500)) await tx.insert(schema.monsterIndex).values(rows)

    return {
      source: { id: sourceId, slug: pkg.source.slug, created: !existingSource },
      entries: counts,
      total: pkg.entries.length,
    }
  })
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
