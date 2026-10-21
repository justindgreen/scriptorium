import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { schema } from '../src/db/client.js'
import {
  entryChecksum,
  importPackage,
  ImportError,
  upsertRuleset,
} from '../src/modules/content/import.js'
import { defaultContentDir } from '../src/modules/content/seed.js'
import {
  createTestApp,
  setupAdmin,
  signUp,
  trpcMutation,
  trpcQuery,
  type TestApp,
} from './helpers/app.js'

const rulesetFile = path.join(defaultContentDir(), 'rulesets', 'srd5.1-2014.json')

const source = {
  slug: 'test-pack',
  name: 'Test Pack',
  kind: 'homebrew',
  license: 'CC-BY-4.0',
  attributionText: 'Test Pack by the test suite.',
  version: '1.0.0',
}

function spell(slug: string, name: string, level: number, description = 'A test spell.') {
  return {
    kind: 'spell',
    uid: `test-pack:spell:${slug}`,
    slug,
    name,
    tags: ['test'],
    data: {
      level,
      school: 'evocation',
      castingTime: '1 action',
      castingTimeType: 'action',
      range: '60 feet',
      components: { verbal: true, somatic: true, material: false },
      duration: 'Instantaneous',
      concentration: false,
      ritual: false,
      description,
      classes: ['test-pack:class:wizard'],
    },
  }
}

const longsword = {
  kind: 'item',
  uid: 'test-pack:item:longsword',
  slug: 'longsword',
  name: 'Longsword',
  data: {
    category: 'weapon',
    description: 'A versatile blade.',
    cost: { quantity: 15, unit: 'gp' },
    weight: 3,
    weapon: {
      category: 'martial',
      range: 'melee',
      damage: { dice: '1d8', damageType: 'slashing' },
      versatileDamage: '1d10',
      properties: ['versatile'],
    },
  },
}

const skeleton = {
  kind: 'monster',
  uid: 'test-pack:monster:skeleton',
  slug: 'skeleton',
  name: 'Skeleton',
  data: {
    size: 'medium',
    type: 'undead',
    alignment: 'lawful evil',
    armorClass: [{ value: 13, source: 'armor scraps' }],
    hitPoints: { average: 13, formula: '2d8+4' },
    speed: { walk: 30 },
    abilities: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
    damageVulnerabilities: ['bludgeoning'],
    damageImmunities: ['poison'],
    conditionImmunities: ['exhaustion', 'poisoned'],
    senses: { darkvision: 60, 'passive perception': 9 },
    languages: 'understands all languages it knew in life but cannot speak',
    challengeRating: 0.25,
    xp: 50,
    proficiencyBonus: 2,
    actions: [
      {
        name: 'Shortsword',
        description:
          'Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) piercing damage.',
        attack: { kind: 'melee', toHit: 4, reach: 5 },
        damage: [{ dice: '1d6+2', damageType: 'piercing' }],
      },
    ],
  },
}

function pkg(entries: unknown[], version = '1.0.0') {
  return {
    format: 'scriptorium-content-package',
    formatVersion: 1,
    source: { ...source, version },
    rulesetId: 'srd5.1-2014',
    entries,
  }
}

describe('content import and reads', () => {
  let t: TestApp
  let adminCookie = ''

  beforeAll(async () => {
    t = await createTestApp()
    adminCookie = (await setupAdmin(t.app)).cookie
  })

  afterAll(async () => {
    await t.close()
  })

  it('loads and validates the bundled 2014 ruleset configuration', async () => {
    const config = JSON.parse(fs.readFileSync(rulesetFile, 'utf8'))
    const first = await upsertRuleset(t.tdb.db, config)
    expect(first).toEqual({ id: 'srd5.1-2014', changed: true })
    const second = await upsertRuleset(t.tdb.db, config)
    expect(second.changed).toBe(false)
    await expect(
      upsertRuleset(t.tdb.db, { ...config, proficiencyBonusByLevel: [2, 2] }),
    ).rejects.toBeInstanceOf(ImportError)
  })

  it('refuses a package for an unknown ruleset and an invalid package with issue paths', async () => {
    await expect(
      importPackage(t.tdb.db, { ...pkg([spell('a', 'A', 1)]), rulesetId: 'nope-2099' }),
    ).rejects.toThrow(/Unknown ruleset/)
    const invalid = {
      ...pkg([
        {
          ...spell('b', 'B', 1),
          effects: [{ type: 'bonus.sneaky', target: 'ac.bonus', value: 1 }],
        },
      ]),
    }
    await expect(importPackage(t.tdb.db, invalid)).rejects.toMatchObject({ name: 'ImportError' })
    try {
      await importPackage(t.tdb.db, invalid)
    } catch (error) {
      expect(
        (error as ImportError).issues.some((i) => i.path.startsWith('entries.0.effects.0')),
      ).toBe(true)
    }
  })

  it('imports a package, then skips unchanged entries and versions changed ones', async () => {
    const first = await importPackage(
      t.tdb.db,
      pkg([spell('glimmer', 'Glimmer', 0), spell('ember', 'Ember', 1), longsword, skeleton]),
    )
    expect(first.source.created).toBe(true)
    expect(first.entries).toEqual({ created: 4, updated: 0, unchanged: 0 })

    const again = await importPackage(
      t.tdb.db,
      pkg([spell('glimmer', 'Glimmer', 0), spell('ember', 'Ember', 1), longsword, skeleton]),
    )
    expect(again.source.created).toBe(false)
    expect(again.entries).toEqual({ created: 0, updated: 0, unchanged: 4 })

    const changed = await importPackage(
      t.tdb.db,
      pkg(
        [
          spell('glimmer', 'Glimmer', 0, 'A brighter mote of light.'),
          spell('ember', 'Ember', 1),
          longsword,
          skeleton,
        ],
        '1.0.1',
      ),
    )
    expect(changed.entries).toEqual({ created: 0, updated: 1, unchanged: 3 })

    const versions = await t.tdb.db
      .select({
        versionNo: schema.contentVersions.versionNo,
        checksum: schema.contentVersions.checksum,
      })
      .from(schema.contentVersions)
      .innerJoin(
        schema.contentEntries,
        eq(schema.contentEntries.id, schema.contentVersions.entryId),
      )
      .where(eq(schema.contentEntries.uid, 'test-pack:spell:glimmer'))
    expect(versions.map((v) => v.versionNo).sort()).toEqual([1, 2])
    expect(new Set(versions.map((v) => v.checksum)).size).toBe(2)
  })

  it('builds projections, tags and relations', async () => {
    const spells = await t.tdb.db.select().from(schema.spellIndex)
    expect(spells.map((s) => s.level).sort()).toEqual([0, 1])
    expect(spells[0]?.classUids).toEqual(['test-pack:class:wizard'])
    const items = await t.tdb.db.select().from(schema.itemIndex)
    expect(items[0]).toMatchObject({
      category: 'weapon',
      costCp: 1500,
      weaponCategory: 'martial',
      magic: false,
    })
    const monsters = await t.tdb.db.select().from(schema.monsterIndex)
    expect(monsters[0]).toMatchObject({ challengeRating: 0.25, type: 'undead' })
    const relations = await t.tdb.db.select().from(schema.contentRelations)
    expect(
      relations.filter((r) => r.relation === 'list_member' && r.toUid === 'test-pack:class:wizard'),
    ).toHaveLength(2)
    const tags = await t.tdb.db.select().from(schema.contentTags)
    expect(tags.filter((r) => r.tag === 'test')).toHaveLength(2)
  })

  it('lists and searches entries through the API, honouring kind filters and disabled sources', async () => {
    const all = await trpcQuery<{ items: Array<{ uid: string }>; total: number }>(
      t.app,
      'content.entries.list',
      { limit: 50 },
      adminCookie,
    )
    expect(all.data?.total).toBe(4)
    const spellsOnly = await trpcQuery<{
      items: Array<{ uid: string; spell: { level: number } | null }>
      total: number
    }>(t.app, 'content.entries.list', { kind: 'spell' }, adminCookie)
    expect(spellsOnly.data?.total).toBe(2)
    expect(spellsOnly.data?.items.every((i) => i.spell !== null)).toBe(true)
    const search = await trpcQuery<{ items: Array<{ uid: string }> }>(
      t.app,
      'content.entries.list',
      { q: 'brighter' },
      adminCookie,
    )
    expect(search.data?.items.map((i) => i.uid)).toEqual(['test-pack:spell:glimmer'])
    const fuzzy = await trpcQuery<{ items: Array<{ uid: string }> }>(
      t.app,
      'content.entries.list',
      { q: 'longswrd' },
      adminCookie,
    )
    expect(fuzzy.data?.items.map((i) => i.uid)).toContain('test-pack:item:longsword')

    const entry = await trpcQuery<{
      version: { versionNo: number; data: { description: string } }
      relations: unknown[]
    }>(t.app, 'content.entries.get', { uid: 'test-pack:spell:glimmer' }, adminCookie)
    expect(entry.data?.version.versionNo).toBe(2)
    expect(entry.data?.version.data.description).toBe('A brighter mote of light.')

    const sources = await trpcQuery<Array<{ id: string; slug: string; entryCount: number }>>(
      t.app,
      'content.sources.list',
      undefined,
      adminCookie,
    )
    const testPack = sources.data!.find((s) => s.slug === 'test-pack')!
    expect(testPack.entryCount).toBe(4)
    await trpcMutation(
      t.app,
      'content.sources.setEnabled',
      { id: testPack.id, enabled: false },
      adminCookie,
    )
    const hidden = await trpcQuery<{ total: number }>(
      t.app,
      'content.entries.list',
      { limit: 50 },
      adminCookie,
    )
    expect(hidden.data?.total).toBe(0)
    const gone = await trpcQuery(
      t.app,
      'content.entries.get',
      { uid: 'test-pack:spell:glimmer' },
      adminCookie,
    )
    expect(gone.error?.code).toBe('NOT_FOUND')
    await trpcMutation(
      t.app,
      'content.sources.setEnabled',
      { id: testPack.id, enabled: true },
      adminCookie,
    )
  })

  it('exposes licences publicly and keeps content management to administrators', async () => {
    const licenses = await trpcQuery<Array<{ slug: string; attributionText: string }>>(
      t.app,
      'content.licenses',
    )
    expect(licenses.data?.find((l) => l.slug === 'test-pack')?.attributionText).toBe(
      source.attributionText,
    )

    const invite = await trpcMutation<{ code: string }>(
      t.app,
      'admin.invites.create',
      {},
      adminCookie,
    )
    const player = await signUp(t.app, {
      username: 'reader',
      name: 'Reader',
      password: 'correct-horse-battery',
      inviteCode: invite.data!.code,
    })
    const readable = await trpcQuery<{ total: number }>(
      t.app,
      'content.entries.list',
      { kind: 'monster' },
      player.cookie,
    )
    expect(readable.data?.total).toBe(1)
    const forbidden = await trpcMutation(
      t.app,
      'content.importPackage',
      { package: pkg([spell('z', 'Z', 1)]) },
      player.cookie,
    )
    expect(forbidden.error?.code).toBe('FORBIDDEN')
    const imported = await trpcMutation<{ entries: { created: number } }>(
      t.app,
      'content.importPackage',
      {
        package: pkg(
          [
            spell('glimmer', 'Glimmer', 0, 'A brighter mote of light.'),
            spell('ember', 'Ember', 1),
            longsword,
            skeleton,
            spell('z', 'Z', 1),
          ],
          '1.0.2',
        ),
      },
      adminCookie,
    )
    expect(imported.data?.entries.created).toBe(1)
  })

  it('checksums ignore property order', () => {
    const a = entryChecksum({
      ...spell('o', 'O', 1),
      effects: [],
      choices: [],
      tests: [],
      relations: [],
    } as never)
    const reordered = {
      ...spell('o', 'O', 1),
      effects: [],
      choices: [],
      tests: [],
      relations: [],
    } as Record<string, unknown>
    reordered['data'] = Object.fromEntries(Object.entries(reordered['data'] as object).reverse())
    expect(entryChecksum(reordered as never)).toBe(a)
  })
})
