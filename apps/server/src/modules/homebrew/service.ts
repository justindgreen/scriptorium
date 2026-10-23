/**
 * Homebrew service (M2.7): personal sources, item drafts, publishing and previews. Ownership is
 * the owner of the source (or an administrator); every stored version passes `contentEntrySchema`.
 */
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import {
  contentEntrySchema,
  type Automation,
  type ContentEntry,
  type ContentEntryOf,
} from '@scriptorium/content-schema'
import {
  computeSheet,
  createSnapshot,
  planAction,
  type ActionPlan,
  type ActionTemplate,
  type CharacterAggregate,
  type ComputedSheet,
  type Diagnostic,
  type InventoryItem,
} from '@scriptorium/rules-engine'
import { schema, type Db } from '../../db/client.js'
import type { CommandRunner } from '../../core/commands.js'
import type { Scope } from '../../core/policy.js'
import type { CharacterRepo } from '../characters/repo.js'
import { characterRootUids, loadSnapshot, referencedUids } from '../characters/snapshot.js'
import type { HomebrewRepo } from './repo.js'
import { itemDraftSchema, type ItemDraftInput } from './schemas.js'

export type ValidationIssue = { path: string; message: string }

/** Inventory id of the item while it is only being previewed. */
export const PREVIEW_ITEM_ID = 'homebrew-preview'

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'item'
}

/** What the sheet does not automate for an item-granted spell (A1 finding D-4, issue #8). */
export function grantedSpellManualPart(spellUid: string): string {
  return `casting ${spellUid}: it is listed under granted spells with its uses or charges, but casting it from the sheet is not automated yet`
}

/**
 * The automation level the effects imply (docs/RULES_ENGINE.md §9): full when every effect is
 * mechanical, partial when manual text or a granted spell sits next to mechanics, manual when
 * nothing is automated. A granted spell is never `full` while casting it is a manual step
 * (rule 7: automation levels are honest).
 */
export function inferAutomation(draft: Pick<ItemDraftInput, 'data' | 'effects'>): Automation {
  const manual = draft.effects.filter(
    (e): e is Extract<typeof e, { type: 'manual' }> => e.type === 'manual',
  )
  const granted = draft.effects.filter(
    (e): e is Extract<typeof e, { type: 'spell.grant' }> => e.type === 'spell.grant',
  )
  const structural = Boolean(draft.data.weapon || draft.data.armor || draft.data.charges)
  const mechanical = draft.effects.length - manual.length - granted.length + (structural ? 1 : 0)
  const manualParts = [
    ...granted.map((g) => grantedSpellManualPart(g.spell).slice(0, 200)),
    ...manual.map((m) => m.text.slice(0, 200)),
  ]
  if (manualParts.length === 0) return mechanical > 0 ? { level: 'full' } : { level: 'manual' }
  if (mechanical > 0 || granted.length > 0) return { level: 'partial', manualParts }
  return { level: 'manual' }
}

function issuesOf(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }))
}

/** Builds and validates the full content entry for a draft. */
export function entryFromDraft(
  draft: ItemDraftInput,
  ids: { uid: string; slug: string },
): { ok: true; entry: ContentEntryOf<'item'> } | { ok: false; issues: ValidationIssue[] } {
  const parsed = contentEntrySchema.safeParse({
    kind: 'item',
    uid: ids.uid,
    slug: ids.slug,
    name: draft.name,
    data: draft.data,
    effects: draft.effects,
    choices: [],
    automation: draft.automation ?? inferAutomation(draft),
    tests: [],
    tags: [],
    relations: [],
  })
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) }
  return { ok: true, entry: parsed.data as ContentEntryOf<'item'> }
}

function storedEntry(row: {
  uid: string
  slug: string
  name: string
  kind: string
  version: { data: unknown; effects: unknown; automation: unknown }
}): ContentEntry {
  return contentEntrySchema.parse({
    kind: row.kind,
    uid: row.uid,
    slug: row.slug,
    name: row.name,
    data: row.version.data,
    effects: row.version.effects,
    choices: [],
    automation: row.version.automation ?? undefined,
    tests: [],
    tags: [],
    relations: [],
  })
}

export type PreviewResult = {
  character: { id: string; name: string }
  templates: ActionTemplate[]
  plan: ActionPlan | null
  granted: NonNullable<ComputedSheet['spellcasting']>['granted']
  diagnostics: Diagnostic[]
  /** Numeric stats the item changes on this character, before and after. */
  changes: Array<{ path: string; before: number; after: number }>
}

export function createHomebrewService(deps: {
  db: Db
  repo: HomebrewRepo
  characters: CharacterRepo
  commands: CommandRunner
}) {
  const { repo } = deps

  function assertOwner(scope: Scope, ownerUserId: string | null): void {
    if (scope.role === 'admin') return
    if (!scope.userId || scope.userId !== ownerUserId)
      throw new TRPCError({ code: 'FORBIDDEN', message: 'That homebrew belongs to someone else.' })
  }

  function invalid(issues: ValidationIssue[]): never {
    const first = issues[0]
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: first ? `${first.path || 'item'}: ${first.message}` : 'Invalid item.',
      cause: issues,
    })
  }

  async function loadOwned(scope: Scope, entryId: string) {
    const item = await repo.getItem(entryId)
    if (!item || item.kind !== 'item')
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Item not found.' })
    assertOwner(scope, item.source.ownerUserId)
    return item
  }

  return {
    listSources(scope: Scope) {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      return repo.listSources(scope.userId)
    },

    async createSource(scope: Scope, input: { name: string; description?: string }) {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const [author] = await deps.db
        .select({ name: schema.user.name })
        .from(schema.user)
        .where(eq(schema.user.id, scope.userId))
        .limit(1)
      const base = slugify(input.name).slice(0, 40)
      let slug = base
      for (let attempt = 0; await repo.slugTaken(slug); attempt += 1) {
        slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
        if (attempt > 20) throw new TRPCError({ code: 'CONFLICT', message: 'Pick another name.' })
      }
      const id = await repo.createSource({
        ownerUserId: scope.userId,
        slug,
        name: input.name,
        attributionText: `Homebrew by ${author?.name ?? 'its author'}`,
        ...(input.description ? { description: input.description } : {}),
      })
      return { id, slug }
    },

    listItems(scope: Scope) {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      return repo.listItems(scope.userId)
    },

    getItem: loadOwned,

    async createItem(scope: Scope, input: { sourceId: string; draft: ItemDraftInput }) {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const source = await repo.getSource(input.sourceId)
      if (!source || source.kind !== 'homebrew')
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found.' })
      assertOwner(scope, source.ownerUserId)
      const base = slugify(input.draft.name).slice(0, 80)
      let slug = base
      for (let n = 2; await repo.uidTaken(`${source.slug}:item:${slug}`); n += 1)
        slug = `${base}-${n}`
      const uid = `${source.slug}:item:${slug}`
      const built = entryFromDraft(input.draft, { uid, slug })
      if (!built.ok) invalid(built.issues)
      const [ruleset] = await deps.db
        .select({ id: schema.rulesets.id })
        .from(schema.rulesets)
        .limit(1)
      if (!ruleset) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No ruleset.' })
      const created = await repo.createDraftEntry({
        sourceId: source.id,
        rulesetId: ruleset.id,
        entry: built.entry,
        createdBy: scope.userId,
        ...(input.draft.changeNote ? { changeNote: input.draft.changeNote } : {}),
      })
      return { entryId: created.entryId, uid, automation: built.entry.automation }
    },

    async saveItem(scope: Scope, input: { entryId: string; draft: ItemDraftInput }) {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const item = await loadOwned(scope, input.entryId)
      const built = entryFromDraft(input.draft, { uid: item.uid, slug: item.slug })
      if (!built.ok) invalid(built.issues)
      const versionId = await repo.saveDraft({
        entryId: item.id,
        draftVersionId: item.draft?.id ?? null,
        headVersionNo: item.head?.versionNo ?? 0,
        entry: built.entry,
        actorId: scope.userId,
        ...(input.draft.changeNote ? { changeNote: input.draft.changeNote } : {}),
      })
      return { versionId, automation: built.entry.automation }
    },

    /** Validates a draft without storing it: the editor shows issues as the author types. */
    validate(input: unknown): {
      ok: boolean
      issues: ValidationIssue[]
      automation: Automation | null
    } {
      const parsed = itemDraftSchema.safeParse(input)
      if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error), automation: null }
      const draft = parsed.data
      const built = entryFromDraft(draft, { uid: 'preview:item:draft', slug: 'draft' })
      return built.ok
        ? { ok: true, issues: [], automation: built.entry.automation ?? inferAutomation(draft) }
        : { ok: false, issues: built.issues, automation: inferAutomation(draft) }
    },

    async publishItem(scope: Scope, entryId: string) {
      const item = await loadOwned(scope, entryId)
      if (!item.draft)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Nothing new to publish.' })
      const entry = storedEntry({ ...item, version: item.draft })
      await repo.publish({ entryId: item.id, draftVersionId: item.draft.id, entry })
      return { uid: item.uid, versionNo: item.draft.versionNo }
    },

    async deleteItem(scope: Scope, entryId: string) {
      const item = await loadOwned(scope, entryId)
      if (item.headVersionId)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Published items cannot be deleted: characters may pin them.',
        })
      await repo.deleteUnpublished(item.id)
      return { ok: true as const }
    },

    /**
     * The item on one of the author's characters, without touching it: the sheet is computed with
     * the draft (or the head) version equipped and attuned, and a weapon is planned against an
     * imagined target so target-typed riders show.
     */
    async preview(
      scope: Scope,
      input: { entryId: string; characterId: string; targetType?: string },
    ): Promise<PreviewResult> {
      const item = await loadOwned(scope, input.entryId)
      const version = item.draft ?? item.head
      if (!version) throw new TRPCError({ code: 'NOT_FOUND', message: 'Item has no content.' })
      const entry = storedEntry({ ...item, version }) as ContentEntryOf<'item'>
      const character = await deps.commands.view(input.characterId)
      if (!character) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      if (scope.role !== 'admin' && character.ownerUserId !== scope.userId)
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'That character belongs to someone else.',
        })
      const pinned = await deps.characters.getPinnedRefs(deps.db, input.characterId)
      const roots = [...characterRootUids(character.aggregate), ...referencedUids(entry)]
      const loaded = await loadSnapshot(deps.db, roots, pinned)
      const snapshot = createSnapshot([
        ...loaded.snapshot.entries().filter((e) => e.uid !== entry.uid),
        entry,
      ])
      const ruleset = await deps.commands.rulesetProfile(character.aggregate.rulesetId)
      const previewItem: InventoryItem = {
        id: PREVIEW_ITEM_ID,
        itemUid: entry.uid,
        quantity: 1,
        equipped: true,
        attuned: entry.data.requiresAttunement,
        sortOrder: 9999,
      }
      const aggregate: CharacterAggregate = {
        ...character.aggregate,
        inventory: [
          ...character.aggregate.inventory.filter((i) => i.itemUid !== entry.uid),
          previewItem,
        ],
      }
      const before = computeSheet(character.aggregate, snapshot, ruleset)
      const sheet = computeSheet(aggregate, snapshot, ruleset)
      const templates = sheet.actionTemplates.filter((t) => t.itemId === PREVIEW_ITEM_ID)
      const weapon = templates.find((t) => t.kind === 'weapon')
      const plan = weapon
        ? planAction(
            sheet,
            aggregate,
            { kind: 'weapon', itemId: PREVIEW_ITEM_ID },
            input.targetType ? { target: { creatureType: input.targetType } } : {},
            snapshot,
          )
        : null
      const mentions = (s: { uid?: string; path: string }) =>
        s.uid === entry.uid || s.path.includes(PREVIEW_ITEM_ID)
      const changes: PreviewResult['changes'] = []
      for (const [path, stat] of Object.entries(sheet.stats)) {
        const was = before.stats[path]?.value
        if (typeof stat.value === 'number' && typeof was === 'number' && stat.value !== was)
          changes.push({ path, before: was, after: stat.value })
      }
      return {
        character: { id: input.characterId, name: character.aggregate.name },
        templates,
        plan,
        granted: sheet.spellcasting?.granted.filter((g) => mentions(g.source)) ?? [],
        diagnostics: sheet.diagnostics.filter((d) => d.sources.some(mentions)),
        changes,
      }
    },
  }
}

export type HomebrewService = ReturnType<typeof createHomebrewService>
