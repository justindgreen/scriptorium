import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultContentDir, seedBundledContent } from '../src/modules/content/seed.js'
import { createTestDatabase, type TestDatabase } from './helpers/database.js'

/** Imports the committed SRD 5.1 packages end to end: counts, idempotency, projections. */
describe('bundled SRD 5.1 content', () => {
  let tdb: TestDatabase

  beforeAll(async () => {
    tdb = await createTestDatabase()
  })

  afterAll(async () => {
    await tdb.drop()
  })

  it('seeds every package with the expected entry counts and is a no-op the second time', async () => {
    const first = await seedBundledContent(tdb.db, { contentDir: defaultContentDir() })
    expect(first.rulesets).toEqual([{ id: 'srd5.1-2014', changed: true }])
    const created = Object.fromEntries(
      first.packages.map((p) => [path.basename(p.file), p.result.entries.created]),
    )
    expect(created).toEqual({
      'srd-5.1.backgrounds-feats.package.json': 2,
      'srd-5.1.classes.package.json': 431,
      'srd-5.1.equipment.package.json': 749,
      'srd-5.1.monsters.package.json': 334,
      'srd-5.1.rules.package.json': 54,
      'srd-5.1.species.package.json': 51,
      'srd-5.1.spells.package.json': 327,
    })

    const second = await seedBundledContent(tdb.db, { contentDir: defaultContentDir() })
    expect(second.rulesets).toEqual([{ id: 'srd5.1-2014', changed: false }])
    expect(
      second.packages.every(
        (p) => p.result.entries.created === 0 && p.result.entries.updated === 0,
      ),
    ).toBe(true)
    expect(second.packages.reduce((n, p) => n + p.result.entries.unchanged, 0)).toBe(1948)
  }, 120_000)

  it('exposes the SRD through the content repository with working projections', async () => {
    const { createContentRepo } = await import('../src/modules/content/repo.js')
    const repo = createContentRepo(tdb.db)
    const counts = Object.fromEntries((await repo.countByKind('srd-5.1')).map((c) => [c.kind, c.n]))
    expect(counts).toMatchObject({
      spell: 319,
      spell_list: 8,
      item: 749,
      monster: 334,
      condition: 15,
      rule: 39,
      class: 12,
      subclass: 12,
      species: 13,
      background: 1,
      feat: 1,
      feature: 445,
    })

    const fireball = await repo.getEntry('srd-5.1:spell:fireball')
    expect(fireball?.version.data).toMatchObject({
      level: 3,
      school: 'evocation',
      concentration: false,
    })
    expect(
      fireball?.relations.some(
        (r) => r.relation === 'list_member' && r.toUid === 'srd-5.1:class:wizard',
      ),
    ).toBe(true)

    const thirdLevel = await repo.listEntries({ kind: 'spell', q: 'fireball', limit: 5, offset: 0 })
    expect(thirdLevel.items[0]?.uid).toBe('srd-5.1:spell:fireball')
    expect(thirdLevel.items[0]?.spell).toMatchObject({ level: 3, school: 'evocation' })

    const goblin = await repo.getEntry('srd-5.1:monster:goblin')
    expect(goblin?.version.data).toMatchObject({
      challengeRating: 0.25,
      type: 'humanoid',
      size: 'small',
    })
    const fighter = await repo.getEntry('srd-5.1:class:fighter')
    expect((fighter?.version.data as { levels: unknown[] }).levels).toHaveLength(20)
    expect(fighter?.version.automation).toEqual({ level: 'full' })
    const shield = await repo.getEntry('srd-5.1:item:shield')
    expect(shield?.version.effects).toEqual([
      { type: 'bonus', target: 'ac.bonus', value: 2, note: 'Shield' },
    ])
    const licenses = await repo.listSources()
    expect(licenses.find((s) => s.slug === 'srd-5.1')?.attributionText).toContain(
      'Creative Commons Attribution 4.0',
    )
  })
})
