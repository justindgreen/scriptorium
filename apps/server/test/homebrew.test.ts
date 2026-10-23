import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ActionPlan, ActionTemplate, ComputedSheet } from '@scriptorium/rules-engine'
import { defaultContentDir, seedBundledContent } from '../src/modules/content/seed.js'
import { inferAutomation, slugify } from '../src/modules/homebrew/service.js'
import {
  createTestApp,
  setupAdmin,
  signUp,
  trpcMutation,
  trpcQuery,
  type TestApp,
} from './helpers/app.js'

/**
 * M2.7: the specification's sword (static +3, target-typed radiant damage, charges, a granted
 * spell, attunement) is authored as a draft, previewed, published, given to a character and
 * stays pinned when the author publishes a new version.
 */
type Source = { id: string; slug: string }
type Created = { entryId: string; uid: string; automation: { level: string } }
type Preview = {
  templates: ActionTemplate[]
  plan: ActionPlan | null
  granted: Array<{ spellUid: string; chargeCost?: number }>
  diagnostics: Array<{ code: string; severity: string; message: string }>
  changes: Array<{ path: string; before: number; after: number }>
}
type View = { id: string; revision: number; sheet: ComputedSheet }
type Added = { revision: number; sheet: ComputedSheet }
type Listed = { items: Array<{ uid: string; name: string }>; total: number }

const sword = {
  name: 'Fiendbane Longsword',
  data: {
    category: 'weapon',
    description: 'A +3 longsword that burns fiends and undead. Three charges of bless.',
    magic: true,
    rarity: 'legendary',
    requiresAttunement: true,
    weapon: {
      category: 'martial',
      range: 'melee',
      damage: { dice: '1d8', damageType: 'slashing' },
      versatileDamage: '1d10',
      properties: ['versatile', 'magical'],
    },
    charges: { max: 3, recharge: { time: 'dawn' } },
  },
  effects: [
    { type: 'bonus', target: 'attack.weapon.self', value: 3, note: '+3 weapon' },
    { type: 'bonus', target: 'damage.weapon.self', value: 3, note: '+3 weapon' },
    {
      type: 'action.damageAdd',
      formula: '1d8',
      damageType: 'radiant',
      label: 'Fiendbane',
      appliesTo: 'weapon.self',
      condition: { leaf: 'ctx.targetType', types: ['fiend', 'undead'] },
    },
    { type: 'spell.grant', spell: 'srd-5.1:spell:bless', chargeCost: 1 },
  ],
}

let t: TestApp
let smith: string
let other: string
let source: Source
let entryId: string
let uid: string
let characterId: string
let revision = 0

async function invite(adminCookie: string) {
  const created = await trpcMutation<{ code: string }>(
    t.app,
    'admin.invites.create',
    { role: 'user', note: 'test' },
    adminCookie,
  )
  return created.data!.code
}

beforeAll(async () => {
  t = await createTestApp()
  await seedBundledContent(t.tdb.db, { contentDir: defaultContentDir() })
  const admin = await setupAdmin(t.app)
  smith = (
    await signUp(t.app, {
      username: 'smith',
      name: 'Smith',
      password: 'another-horse-battery',
      inviteCode: await invite(admin.cookie),
    })
  ).cookie
  other = (
    await signUp(t.app, {
      username: 'other',
      name: 'Other',
      password: 'another-horse-battery',
      inviteCode: await invite(admin.cookie),
    })
  ).cookie
  const character = await trpcMutation<View>(
    t.app,
    'characters.create',
    {
      name: 'Vance',
      speciesUid: 'srd-5.1:species:human',
      backgroundUid: 'srd-5.1:background:acolyte',
      classUid: 'srd-5.1:class:fighter',
      baseAbilities: { str: 15, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
      abilityMethod: 'manual',
    },
    smith,
  )
  characterId = character.data!.id
  revision = character.data!.revision
}, 120_000)

afterAll(async () => {
  await t.close()
})

describe('helpers', () => {
  it('slugifies names and infers automation honestly', () => {
    expect(slugify('Fiendbane Longsword!')).toBe('fiendbane-longsword')
    // A granted spell is listed but not castable from the sheet (D-4), so never `full` (issue #8).
    expect(inferAutomation(sword as never)).toEqual({
      level: 'partial',
      manualParts: [expect.stringContaining('casting srd-5.1:spell:bless')],
    })
    expect(inferAutomation({ ...sword, effects: sword.effects.slice(0, 3) } as never)).toEqual({
      level: 'full',
    })
    expect(
      inferAutomation({
        data: { category: 'wondrous', description: '', magic: true, requiresAttunement: false },
        effects: [{ type: 'manual', text: 'Glows near fiends.' }],
      } as never),
    ).toEqual({ level: 'manual' })
    expect(
      inferAutomation({
        data: sword.data,
        effects: [sword.effects[0], { type: 'manual', text: 'Hums.' }],
      } as never),
    ).toEqual({ level: 'partial', manualParts: ['Hums.'] })
  })
})

describe('homebrew sources and item drafts', () => {
  it('creates a personal source with a usable slug', async () => {
    const created = await trpcMutation<Source>(
      t.app,
      'homebrew.sources.create',
      { name: "Smith's Forge" },
      smith,
    )
    expect(created.status).toBe(200)
    source = created.data!
    expect(source.slug).toMatch(/^smith-s-forge/)
    const listed = await trpcQuery<Source[]>(t.app, 'homebrew.sources.list', undefined, smith)
    expect(listed.data!.map((s) => s.id)).toContain(source.id)
    const others = await trpcQuery<Source[]>(t.app, 'homebrew.sources.list', undefined, other)
    expect(others.data).toEqual([])
  })

  it('refuses an invalid draft with the offending path', async () => {
    const bad = await trpcMutation(
      t.app,
      'homebrew.items.create',
      {
        sourceId: source.id,
        draft: {
          ...sword,
          effects: [{ type: 'bonus', target: 'nonsense.path', value: 1 }],
        },
      },
      smith,
    )
    expect(bad.status).toBe(400)
    expect(bad.error?.message).toMatch(/unknown stat path/)
    const validated = await trpcQuery<{ ok: boolean; issues: Array<{ path: string }> }>(
      t.app,
      'homebrew.items.validate',
      { ...sword, effects: [{ type: 'bonus', target: 'nonsense.path', value: 1 }] },
      smith,
    )
    expect(validated.data!.ok).toBe(false)
    expect(validated.data!.issues[0]!.path).toContain('effects.0')
  })

  it('creates the sword as a draft with inferred partial automation (granted spell casting is manual)', async () => {
    const created = await trpcMutation<Created>(
      t.app,
      'homebrew.items.create',
      { sourceId: source.id, draft: sword },
      smith,
    )
    expect(created.status).toBe(200)
    entryId = created.data!.entryId
    uid = created.data!.uid
    expect(uid).toBe(`${source.slug}:item:fiendbane-longsword`)
    expect(created.data!.automation.level).toBe('partial')
    const item = await trpcQuery<{ status: string; draft: { versionNo: number }; head: null }>(
      t.app,
      'homebrew.items.get',
      { entryId },
      smith,
    )
    expect(item.data!.status).toBe('draft')
    expect(item.data!.draft.versionNo).toBe(1)
    expect(item.data!.head).toBeNull()
    // Drafts never appear in the compendium.
    const listed = await trpcQuery<Listed>(
      t.app,
      'content.entries.list',
      { kind: 'item', q: 'Fiendbane' },
      smith,
    )
    expect(listed.data!.total).toBe(0)
  })

  it('keeps other users out of the draft', async () => {
    const read = await trpcQuery(t.app, 'homebrew.items.get', { entryId }, other)
    expect(read.error?.code).toBe('FORBIDDEN')
    const write = await trpcMutation(t.app, 'homebrew.items.save', { entryId, draft: sword }, other)
    expect(write.error?.code).toBe('FORBIDDEN')
  })

  it('previews the draft on the author character without changing it', async () => {
    const preview = await trpcQuery<Preview>(
      t.app,
      'homebrew.items.preview',
      { entryId, characterId, targetType: 'fiend' },
      smith,
    )
    expect(preview.status).toBe(200)
    const template = preview.data!.templates[0]!
    // STR 16 (+3 with the human bonus) + proficiency 2 + the sword's 3.
    expect(template.attack!.bonus).toBe(8)
    expect(template.damage[0]!.text).toBe('1d8 + 6 slashing')
    expect(preview.data!.plan!.damage.map((d) => d.damageType)).toEqual(['slashing', 'radiant'])
    expect(preview.data!.granted[0]).toMatchObject({
      spellUid: 'srd-5.1:spell:bless',
      chargeCost: 1,
    })
    // Issue #8: the diagnostic explains the manual part instead of calling the grant unsupported.
    const codes = preview.data!.diagnostics.map((d) => d.code)
    expect(codes).toContain('PARTIAL_AUTOMATION')
    expect(codes).not.toContain('UNSUPPORTED_EFFECT')
    expect(preview.data!.diagnostics.find((d) => d.code === 'PARTIAL_AUTOMATION')!.message).toMatch(
      /listed under granted spells/,
    )
    const noTarget = await trpcQuery<Preview>(
      t.app,
      'homebrew.items.preview',
      { entryId, characterId },
      smith,
    )
    expect(noTarget.data!.plan!.questions.map((q) => q.id)).toContain('target.creatureType')
    const view = await trpcQuery<View>(t.app, 'characters.get', { characterId }, smith)
    expect(view.data!.revision).toBe(revision)
    expect(view.data!.sheet.actionTemplates.some((a) => a.name === sword.name)).toBe(false)
  })
})

describe('publishing and using the item', () => {
  it('publishes, then the owner (and nobody else) finds it in the compendium', async () => {
    const published = await trpcMutation<{ uid: string; versionNo: number }>(
      t.app,
      'homebrew.items.publish',
      { entryId },
      smith,
    )
    expect(published.status).toBe(200)
    expect(published.data).toEqual({ uid, versionNo: 1 })
    const mine = await trpcQuery<Listed>(
      t.app,
      'content.entries.list',
      { kind: 'item', q: 'Fiendbane' },
      smith,
    )
    expect(mine.data!.items.map((i) => i.uid)).toEqual([uid])
    const theirs = await trpcQuery<Listed>(
      t.app,
      'content.entries.list',
      { kind: 'item', q: 'Fiendbane' },
      other,
    )
    expect(theirs.data!.total).toBe(0)
    const hidden = await trpcQuery(t.app, 'content.entries.get', { uid }, other)
    expect(hidden.error?.code).toBe('NOT_FOUND')
    const again = await trpcMutation(t.app, 'homebrew.items.publish', { entryId }, smith)
    expect(again.error?.code).toBe('PRECONDITION_FAILED')
  })

  it('is given to the character and its mechanics appear once attuned', async () => {
    const added = await trpcMutation<Added>(
      t.app,
      'characters.command',
      {
        characterId,
        commandId: randomUUID(),
        expectedRevision: revision,
        command: { type: 'addItem', itemId: 'sword', itemUid: uid, equipped: true },
      },
      smith,
    )
    expect(added.status).toBe(200)
    revision = added.data!.revision
    const unattuned = added.data!.sheet.actionTemplates.find((a) => a.itemId === 'sword')!
    expect(unattuned.attack!.bonus).toBe(5)
    // A charged item arrives full; the sheet names it and says why it is inactive.
    expect(added.data!.sheet.items.find((i) => i.itemId === 'sword')).toMatchObject({
      name: sword.name,
      active: false,
      inactiveReason: 'not attuned',
      charges: { current: 3, max: 3 },
    })
    const attuned = await trpcMutation<Added>(
      t.app,
      'characters.command',
      {
        characterId,
        commandId: randomUUID(),
        expectedRevision: revision,
        command: { type: 'attune', itemId: 'sword' },
      },
      smith,
    )
    revision = attuned.data!.revision
    const template = attuned.data!.sheet.actionTemplates.find((a) => a.itemId === 'sword')!
    expect(template.attack!.bonus).toBe(8)
    expect(template.riders).toHaveLength(1)
    const plan = await trpcQuery<ActionPlan>(
      t.app,
      'characters.plan',
      {
        characterId,
        ref: { kind: 'weapon', itemId: 'sword' },
        ctx: { target: { creatureType: 'undead' } },
      },
      smith,
    )
    expect(plan.data!.damage.map((d) => `${d.formula} ${d.damageType}`)).toEqual([
      '1d8 + 6 slashing',
      '1d8 radiant',
    ])
  })

  it('cannot be given to a character by someone who cannot see it', async () => {
    const theirs = await trpcMutation<View>(
      t.app,
      'characters.create',
      { name: 'Nobody', classUid: 'srd-5.1:class:fighter' },
      other,
    )
    const refused = await trpcMutation(
      t.app,
      'characters.command',
      {
        characterId: theirs.data!.id,
        commandId: randomUUID(),
        expectedRevision: theirs.data!.revision,
        command: { type: 'addItem', itemId: 'stolen', itemUid: uid, equipped: true },
      },
      other,
    )
    expect(refused.error?.code).toBe('BAD_REQUEST')
  })

  it('republishes as a new version while the character keeps the pinned one', async () => {
    const weaker = {
      ...sword,
      effects: [{ type: 'bonus', target: 'attack.weapon.self', value: 1 }],
      changeNote: 'Nerfed to +1',
    }
    const saved = await trpcMutation<{ versionId: string }>(
      t.app,
      'homebrew.items.save',
      { entryId, draft: weaker },
      smith,
    )
    expect(saved.status).toBe(200)
    const item = await trpcQuery<{
      status: string
      draft: { versionNo: number }
      head: { versionNo: number }
    }>(t.app, 'homebrew.items.get', { entryId }, smith)
    expect(item.data!.head.versionNo).toBe(1)
    expect(item.data!.draft.versionNo).toBe(2)
    const published = await trpcMutation<{ versionNo: number }>(
      t.app,
      'homebrew.items.publish',
      { entryId },
      smith,
    )
    expect(published.data!.versionNo).toBe(2)
    const head = await trpcQuery<{ version: { versionNo: number } }>(
      t.app,
      'content.entries.get',
      { uid },
      smith,
    )
    expect(head.data!.version.versionNo).toBe(2)
    const view = await trpcQuery<View>(t.app, 'characters.get', { characterId }, smith)
    const template = view.data!.sheet.actionTemplates.find((a) => a.itemId === 'sword')!
    expect(template.attack!.bonus).toBe(8)
    const removal = await trpcMutation(t.app, 'homebrew.items.delete', { entryId }, smith)
    expect(removal.error?.code).toBe('PRECONDITION_FAILED')
  })

  it('deletes a draft that was never published', async () => {
    const scrap = await trpcMutation<Created>(
      t.app,
      'homebrew.items.create',
      { sourceId: source.id, draft: { ...sword, name: 'Scrap Blade' } },
      smith,
    )
    const removed = await trpcMutation<{ ok: true }>(
      t.app,
      'homebrew.items.delete',
      { entryId: scrap.data!.entryId },
      smith,
    )
    expect(removed.data).toEqual({ ok: true })
    const gone = await trpcQuery(
      t.app,
      'homebrew.items.get',
      { entryId: scrap.data!.entryId },
      smith,
    )
    expect(gone.error?.code).toBe('NOT_FOUND')
  })
})
