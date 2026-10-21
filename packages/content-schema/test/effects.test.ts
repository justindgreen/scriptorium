import { describe, expect, it } from 'vitest'
import {
  checkFormula,
  effectSchema,
  isStatPath,
  parseContentEntry,
  staticEffectSchema,
} from '../src/index.js'

const ok = (input: unknown) => effectSchema.safeParse(input).success
const firstIssue = (input: unknown) => {
  const r = effectSchema.safeParse(input)
  return r.success ? null : (r.error.issues[0]?.message ?? 'invalid')
}

describe('effect catalogue', () => {
  it('accepts representative static effects', () => {
    expect(ok({ type: 'abilityScore.bonus', ability: 'dex', value: 2 })).toBe(true)
    expect(
      ok({ type: 'proficiency.grant', kind: 'skill', target: 'stealth', level: 'expertise' }),
    ).toBe(true)
    expect(
      ok({ type: 'bonus', target: 'ac.bonus', value: 1, stackKey: 'ring-of-protection' }),
    ).toBe(true)
    expect(ok({ type: 'ac.formula', formula: '10 + DEX + CON', label: 'Unarmored Defense' })).toBe(
      true,
    )
    expect(ok({ type: 'advantage', on: 'save.vs.poison' })).toBe(true)
    expect(ok({ type: 'damage.resistance', damageType: 'poison' })).toBe(true)
    expect(
      ok({
        type: 'damage.resistance',
        damageType: 'bludgeoning',
        condition: { not: { leaf: 'packet.magical' } },
      }),
    ).toBe(true)
    expect(ok({ type: 'attack.extra', count: 1 })).toBe(true)
    expect(
      ok({
        type: 'resource.define',
        resource: { id: 'second-wind', name: 'Second Wind', max: 1, recharge: 'shortRest' },
      }),
    ).toBe(true)
    expect(
      ok({
        type: 'bonus',
        target: 'hp.max',
        value: 'level * 2',
        condition: { leaf: 'level', gte: 1 },
      }),
    ).toBe(true)
    expect(ok({ type: 'hook', hook: 'scalingDieTable', params: { table: 'sneak-attack' } })).toBe(
      true,
    )
    expect(ok({ type: 'manual', text: 'You can speak with small beasts.' })).toBe(true)
  })

  it('accepts representative action effects', () => {
    expect(
      ok({
        type: 'action.damageAdd',
        formula: '1d8',
        damageType: 'radiant',
        condition: { leaf: 'ctx.targetType', types: ['fiend', 'undead'] },
      }),
    ).toBe(true)
    expect(
      ok({
        type: 'action.damageAdd',
        formula: "table('sneak-attack', classLevel('srd-5.1:class:rogue'))",
        damageType: 'weapon',
        oncePerTurn: 'sneak-attack',
        condition: { any: [{ leaf: 'ctx.hasAdvantage' }, { leaf: 'ctx.allyAdjacent' }] },
      }),
    ).toBe(true)
    expect(
      ok({ type: 'action.rerollDamageDice', values: [1, 2], once: true, appliesTo: 'melee' }),
    ).toBe(true)
  })

  it('rejects an unknown effect type', () => {
    expect(ok({ type: 'bonus.sneaky', target: 'ac.bonus', value: 1 })).toBe(false)
  })

  it('rejects a static effect that uses an action-scoped predicate (scope violation)', () => {
    const result = staticEffectSchema.safeParse({
      type: 'bonus',
      target: 'attack.melee',
      value: 2,
      condition: { leaf: 'ctx.targetType', types: ['undead'] },
    })
    expect(result.success).toBe(false)
    expect(
      ok({
        type: 'bonus',
        target: 'attack.melee',
        value: 2,
        condition: { leaf: 'ctx.hasAdvantage' },
      }),
    ).toBe(false)
  })

  it('rejects formulas with unknown variables and bad syntax', () => {
    expect(firstIssue({ type: 'bonus', target: 'hp.max', value: 'level * CHR' })).toMatch(
      /unknown variable "CHR"/,
    )
    expect(firstIssue({ type: 'bonus', target: 'hp.max', value: 'floor(level / 2' })).toMatch(
      /unbalanced/,
    )
    // slotLevel is only meaningful while resolving an action
    expect(ok({ type: 'bonus', target: 'damage.melee', value: 'slotLevel' })).toBe(false)
    expect(
      ok({ type: 'action.damageAdd', formula: '(slotLevel + 1)d8', damageType: 'radiant' }),
    ).toBe(false) // dice need literal counts
    expect(ok({ type: 'action.saveDC', value: '8 + PB + slotLevel' })).toBe(true)
  })

  it('rejects unknown hooks and unknown stat paths', () => {
    expect(ok({ type: 'hook', hook: 'wizard.doEverything', params: {} })).toBe(false)
    expect(ok({ type: 'hook', hook: 'scalingDieTable', params: {} })).toBe(true)
    expect(firstIssue({ type: 'bonus', target: 'ac.totally-made-up', value: 1 })).toMatch(
      /unknown stat path/,
    )
  })

  it('validates stat path families', () => {
    for (const path of [
      'ability.str.mod',
      'skill.sleight-of-hand.bonus',
      'resource.ki.max',
      'spell.slots.3',
      'defense.resistance.fire',
      'roll.advantage.save.vs.frightened',
    ]) {
      expect(isStatPath(path), path).toBe(true)
    }
    for (const path of ['ability.lck.mod', 'spell.slots.10', 'defense.resistance.sarcasm', 'hp']) {
      expect(isStatPath(path), path).toBe(false)
    }
  })

  it('checks formulas per scope', () => {
    expect(checkFormula('8 + PB + castingMod', 'static')).toBeNull()
    expect(checkFormula('max(1, floor(level / 2))', 'static')).toBeNull()
    expect(checkFormula('2d6 + STR', 'action')).toBeNull()
    expect(checkFormula('slotLevel * 2', 'static')).toMatchObject({
      message: expect.stringContaining('slotLevel'),
    })
    expect(checkFormula('STR; drop table', 'static')).toMatchObject({
      message: expect.stringContaining('unexpected character'),
    })
  })
})

describe('content entries', () => {
  const feature = {
    kind: 'feature',
    uid: 'srd-5.1:feature:second-wind',
    slug: 'second-wind',
    name: 'Second Wind',
    data: {
      description: 'You have a limited well of stamina.',
      level: 1,
      owner: 'srd-5.1:class:fighter',
    },
    effects: [
      {
        type: 'resource.define',
        resource: { id: 'second-wind', name: 'Second Wind', max: 1, recharge: 'shortRest' },
      },
      {
        type: 'action.grant',
        name: 'Second Wind',
        actionType: 'bonus',
        healing: "1d10 + classLevel('srd-5.1:class:fighter')",
        cost: { resource: 'second-wind', amount: 1 },
      },
    ],
    automation: { level: 'full' },
    tests: [
      { given: { fixture: 'fighter-1' }, expect: { stat: 'resource.second-wind.max', equals: 1 } },
    ],
  }

  it('accepts a fully automated feature', () => {
    const result = parseContentEntry(feature)
    expect(result.ok).toBe(true)
  })

  it('refuses a "full" claim without mechanics and a "full" claim with manual effects', () => {
    const noMechanics = parseContentEntry({
      ...feature,
      effects: [],
      automation: { level: 'full' },
    })
    expect(noMechanics.ok).toBe(false)
    const withManual = parseContentEntry({
      ...feature,
      effects: [...feature.effects, { type: 'manual', text: 'and more' }],
      automation: { level: 'full' },
    })
    expect(withManual.ok).toBe(false)
    const partialNeedsParts = parseContentEntry({ ...feature, automation: { level: 'partial' } })
    expect(partialNeedsParts.ok).toBe(false)
  })

  it('refuses a uid that disagrees with kind or slug', () => {
    expect(parseContentEntry({ ...feature, uid: 'srd-5.1:spell:second-wind' }).ok).toBe(false)
    expect(parseContentEntry({ ...feature, uid: 'srd-5.1:feature:first-wind' }).ok).toBe(false)
  })
})
