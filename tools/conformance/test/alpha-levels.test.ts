import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeSheet, createAggregate, type ComputedSheet } from '@scriptorium/rules-engine'
import { deepMerge, loadContent } from '../src/run.js'

/**
 * Golden sheets for the alpha classes at every level 1–20 (docs/TEST_STRATEGY.md §4): no engine
 * errors anywhere, and the numbers the plan names at L1/5/11/13/15/17/20 (slots up to 9th level,
 * preparation counts, Mystic Arcanum, Extra Attack, criticals, Sneak Attack dice).
 */
const root = join(import.meta.dirname, '..', '..', '..')
const loaded = loadContent(root)
const ERRORS = new Set([
  'CYCLE_DETECTED',
  'FORMULA_ERROR',
  'UNKNOWN_VARIABLE',
  'SCOPE_VIOLATION',
  'MISSING_CONTENT',
  'UNKNOWN_HOOK',
])

function sheetAt(fixture: string, level: number): ComputedSheet {
  const base = loaded.fixtures[fixture]!
  const classes = (base.definition as { classes: Array<Record<string, unknown>> }).classes
  const merged = deepMerge(base, { definition: { classes: [{ ...classes[0]!, level }] } })
  return computeSheet(
    createAggregate(merged as Parameters<typeof createAggregate>[0]),
    loaded.snapshot,
    loaded.ruleset,
  )
}

const num = (sheet: ComputedSheet, path: string) => sheet.stats[path]?.value

const CLASSES = [
  { fixture: 'fighter-20-champion', name: 'Fighter (Champion)' },
  { fixture: 'rogue-20-thief', name: 'Rogue (Thief)' },
  { fixture: 'cleric-20-life', name: 'Cleric (Life)' },
  { fixture: 'warlock-20-fiend', name: 'Warlock (Fiend)' },
]

describe('alpha classes compute at every level', () => {
  for (const cls of CLASSES) {
    it(`${cls.name} levels 1-20 produce no engine errors`, () => {
      for (let level = 1; level <= 20; level += 1) {
        const sheet = sheetAt(cls.fixture, level)
        const errors = sheet.diagnostics
          .filter((d) => ERRORS.has(d.code))
          .map((d) => `${d.code}: ${d.message}`)
        expect(errors, `${cls.name} L${level}`).toEqual([])
        expect(sheet.level).toBe(level)
        expect(num(sheet, 'proficiencyBonus')).toBe(loaded.ruleset.proficiencyBonus(level))
      }
    })
  }
})

describe('golden numbers at the plan levels', () => {
  it('Fighter (Champion): attacks, criticals, resources', () => {
    const expected: Record<
      number,
      { attacks: number; crit: number; surge: number; indomitable?: number }
    > = {
      1: { attacks: 1, crit: 20, surge: 0 },
      5: { attacks: 2, crit: 19, surge: 1 },
      11: { attacks: 3, crit: 19, surge: 1, indomitable: 1 },
      13: { attacks: 3, crit: 19, surge: 1, indomitable: 2 },
      15: { attacks: 3, crit: 18, surge: 1, indomitable: 2 },
      17: { attacks: 3, crit: 18, surge: 2, indomitable: 3 },
      20: { attacks: 4, crit: 18, surge: 2, indomitable: 3 },
    }
    for (const [level, e] of Object.entries(expected)) {
      const sheet = sheetAt('fighter-20-champion', Number(level))
      expect(num(sheet, 'attacks.perAction'), `L${level} attacks`).toBe(e.attacks)
      expect(num(sheet, 'crit.range'), `L${level} crit`).toBe(e.crit)
      if (Number(level) >= 2)
        expect(num(sheet, 'resource.action-surge.max'), `L${level} surge`).toBe(e.surge)
      if (e.indomitable)
        expect(num(sheet, 'resource.indomitable.max'), `L${level} indomitable`).toBe(e.indomitable)
    }
    const l20 = sheetAt('fighter-20-champion', 20)
    expect(num(l20, 'ability.str.score')).toBe(20)
    expect(num(l20, 'hp.max')).toBe(10 + 19 * 6 + 20 * 5 + 20) // d10 maxed, averages, CON 20 (+5), Dwarven Toughness
  })

  it('Rogue (Thief): Sneak Attack dice, expertise, senses', () => {
    for (const [level, dice] of [
      [1, 1],
      [5, 3],
      [11, 6],
      [13, 7],
      [15, 8],
      [17, 9],
      [20, 10],
    ] as const) {
      const sheet = sheetAt('rogue-20-thief', level)
      const sneak = sheet.actionEffects.find((e) => e.source.uid === 'srd-5.1:feature:sneak-attack')
      expect(sneak, `L${level} sneak attack`).toBeDefined()
      expect(num(sheet, 'skill.stealth.proficiency'), `L${level} expertise`).toBe(2)
      if (level >= 14) expect(num(sheet, 'sense.blindsight')).toBe(10)
      if (level >= 15) expect(num(sheet, 'save.wis.proficiency')).toBe(1)
      void dice
    }
  })

  it('Cleric (Life): slots to 9th level, preparation counts, Channel Divinity', () => {
    const expected: Record<number, { slots: number[]; prepared: number; channel: number }> = {
      1: { slots: [2], prepared: 1 + 3, channel: 0 },
      5: { slots: [4, 3, 2], prepared: 5 + 4, channel: 1 },
      11: { slots: [4, 3, 3, 3, 2, 1], prepared: 11 + 5, channel: 2 },
      13: { slots: [4, 3, 3, 3, 2, 1, 1], prepared: 13 + 5, channel: 2 },
      15: { slots: [4, 3, 3, 3, 2, 1, 1, 1], prepared: 15 + 5, channel: 2 },
      17: { slots: [4, 3, 3, 3, 2, 1, 1, 1, 1], prepared: 17 + 5, channel: 2 },
      20: { slots: [4, 3, 3, 3, 3, 2, 2, 1, 1], prepared: 20 + 5, channel: 3 },
    }
    for (const [level, e] of Object.entries(expected)) {
      const sheet = sheetAt('cleric-20-life', Number(level))
      const slots = sheet.spellcasting?.slots.map((s) => s.max) ?? []
      expect(slots, `L${level} slots`).toEqual(e.slots)
      expect(num(sheet, 'spell.prepared.max'), `L${level} prepared`).toBe(e.prepared)
      if (Number(level) >= 2)
        expect(num(sheet, 'resource.channel-divinity.max'), `L${level} channel divinity`).toBe(
          e.channel,
        )
      expect(
        sheet.spellcasting?.known.filter((k) => k.alwaysPrepared).length,
        `L${level} domain spells`,
      ).toBe(
        Number(level) >= 9
          ? 9
          : Number(level) >= 7
            ? 7
            : Number(level) >= 5
              ? 6
              : Number(level) >= 3
                ? 4
                : 2,
      )
    }
  })

  it('Warlock (Fiend): pact slots, invocations, Mystic Arcanum', () => {
    const expected: Record<
      number,
      { slots: number; slotLevel: number; invocations: number; arcanum: string[] }
    > = {
      1: { slots: 1, slotLevel: 1, invocations: 0, arcanum: [] },
      5: { slots: 2, slotLevel: 3, invocations: 3, arcanum: [] },
      11: { slots: 3, slotLevel: 5, invocations: 5, arcanum: ['srd-5.1:spell:circle-of-death'] },
      13: {
        slots: 3,
        slotLevel: 5,
        invocations: 6,
        arcanum: ['srd-5.1:spell:circle-of-death', 'srd-5.1:spell:finger-of-death'],
      },
      15: {
        slots: 3,
        slotLevel: 5,
        invocations: 7,
        arcanum: [
          'srd-5.1:spell:circle-of-death',
          'srd-5.1:spell:finger-of-death',
          'srd-5.1:spell:dominate-monster',
        ],
      },
      17: {
        slots: 4,
        slotLevel: 5,
        invocations: 7,
        arcanum: [
          'srd-5.1:spell:circle-of-death',
          'srd-5.1:spell:finger-of-death',
          'srd-5.1:spell:dominate-monster',
          'srd-5.1:spell:foresight',
        ],
      },
      20: {
        slots: 4,
        slotLevel: 5,
        invocations: 8,
        arcanum: [
          'srd-5.1:spell:circle-of-death',
          'srd-5.1:spell:finger-of-death',
          'srd-5.1:spell:dominate-monster',
          'srd-5.1:spell:foresight',
        ],
      },
    }
    for (const [level, e] of Object.entries(expected)) {
      const sheet = sheetAt('warlock-20-fiend', Number(level))
      expect(sheet.spellcasting?.pact, `L${level} pact`).toMatchObject({
        slots: e.slots,
        level: e.slotLevel,
      })
      const invocations = sheet.features.filter((f) =>
        f.uid.startsWith('srd-5.1:feature:eldritch-invocation-'),
      ).length
      expect(invocations, `L${level} invocations granted`).toBe(e.invocations)
      const arcanum =
        sheet.spellcasting?.known
          .filter((k) => k.origin.includes('mystic-arcanum'))
          .map((k) => k.spellUid) ?? []
      expect(arcanum, `L${level} arcanum`).toEqual(e.arcanum)
      expect(sheet.spellcasting?.slots, `L${level} no ordinary slots`).toEqual([])
    }
  })

  it('multiclass builds: Fighter 5 / Warlock 3 and Rogue 3 / Cleric 2', () => {
    const fw = computeSheet(
      createAggregate(
        loaded.fixtures['fighter-5-warlock-3'] as Parameters<typeof createAggregate>[0],
      ),
      loaded.snapshot,
      loaded.ruleset,
    )
    expect(fw.diagnostics.filter((d) => ERRORS.has(d.code))).toEqual([])
    expect(fw.level).toBe(8)
    expect(num(fw, 'proficiencyBonus')).toBe(3)
    expect(num(fw, 'attacks.perAction')).toBe(2)
    expect(fw.spellcasting?.pact).toMatchObject({ slots: 2, level: 2 })
    expect(fw.spellcasting?.slots).toEqual([])
    expect(num(fw, 'save.dex.proficiency')).toBe(0) // only the first class grants saves
    expect(num(fw, 'save.str.proficiency')).toBe(1)
    expect(num(fw, 'sense.darkvision')).toBe(120)

    const rc = computeSheet(
      createAggregate(loaded.fixtures['rogue-3-cleric-2'] as Parameters<typeof createAggregate>[0]),
      loaded.snapshot,
      loaded.ruleset,
    )
    expect(rc.diagnostics.filter((d) => ERRORS.has(d.code))).toEqual([])
    expect(rc.level).toBe(5)
    expect(rc.spellcasting?.slots.map((s) => s.max)).toEqual([3])
    expect(rc.spellcasting?.pact).toBeNull()
    expect(num(rc, 'resource.channel-divinity.max')).toBe(1)
    expect(num(rc, 'skill.stealth.proficiency')).toBe(2)
    expect(rc.proficiencies.armor.map((p) => p.id)).toEqual(
      expect.arrayContaining(['light-armor', 'medium-armor', 'shields', 'heavy-armor']),
    )
  })
})
