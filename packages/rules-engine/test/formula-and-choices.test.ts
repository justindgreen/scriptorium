import { describe, expect, it } from 'vitest'
import {
  FormulaError,
  applySelection,
  evaluateNumeric,
  substituteVariables,
  type FormulaScope,
} from '../src/index.js'

const scope: FormulaScope = {
  abilityMod: (a) => ({ str: 3, dex: 2, con: 1, int: 0, wis: -1, cha: -2 })[a],
  abilityScore: (a) => ({ str: 16, dex: 14, con: 12, int: 10, wis: 8, cha: 6 })[a],
  proficiencyBonus: () => 3,
  level: () => 5,
  classLevel: (uid) => (uid === 'srd-5.1:class:rogue' ? 5 : 0),
  castingMod: () => {
    throw new FormulaError('no spellcasting', 'UNKNOWN_VARIABLE')
  },
  table: (name, level) => (name === 'sneak-attack' ? Math.ceil(level / 2) : 0),
}

describe('static formulas', () => {
  it('resolves variables, class levels and tables', () => {
    expect(evaluateNumeric('STR + PB', scope)).toBe(6)
    expect(evaluateNumeric('STRscore + DEXscore', scope)).toBe(30)
    expect(evaluateNumeric('floor(level / 2) + CON', scope)).toBe(3)
    expect(evaluateNumeric("classLevel('srd-5.1:class:rogue') * 2", scope)).toBe(10)
    expect(evaluateNumeric("table('sneak-attack', classLevel('srd-5.1:class:rogue'))", scope)).toBe(
      3,
    )
    expect(evaluateNumeric("table('sneak-attack')", scope)).toBe(3) // defaults to character level
    expect(evaluateNumeric('max(STR, DEX) + min(1, 2) + abs(WIS) + ceil(5 / 2)', scope)).toBe(8)
    expect(evaluateNumeric(7, scope)).toBe(7)
  })

  it('refuses dice, unknown names and malformed input', () => {
    expect(() => evaluateNumeric('1d6 + STR', scope)).toThrow('dice are not allowed')
    expect(() => evaluateNumeric('bogus', scope)).toThrow('unknown variable "bogus"')
    expect(() => evaluateNumeric('castingMod', scope)).toThrow('no spellcasting')
    expect(() => evaluateNumeric('STR +', scope)).toThrow('invalid formula')
    expect(() => evaluateNumeric('magic(1)', scope)).toThrow('unknown function "magic"')
    expect(() => evaluateNumeric('classLevel(5)', scope)).toThrow('expects a quoted name')
    expect(() => evaluateNumeric('1 / 0', scope)).toThrow('division by zero')
  })

  it('substitutes variables for display while keeping dice symbolic', () => {
    expect(substituteVariables("1d10 + classLevel('srd-5.1:class:rogue')", scope)).toBe('1d10 + 5')
    expect(substituteVariables('2d6 + STR + floor(PB / 2)', scope)).toBe('2d6 + 3 + floor(3 / 2)')
  })
})

const source = { kind: 'feature' as const, name: 'Test', path: 'test', order: 0 }

describe('choice selections', () => {
  it('turns skill selections into proficiency grants and reports the remainder', () => {
    const definition = {
      key: 'k',
      source,
      choice: {
        type: 'choice' as const,
        key: 'skills',
        name: 'Skills',
        count: 2,
        from: {
          kind: 'skill' as const,
          from: ['athletics' as const, 'stealth' as const],
          expertise: false,
        },
      },
    }
    const partial = applySelection(definition, { kind: 'skill', skills: ['athletics', 'arcana'] })
    expect(partial.grants[0]?.effects).toEqual([
      { type: 'proficiency.grant', kind: 'skill', target: 'athletics', level: 'proficient' },
    ])
    expect(partial.pending?.remaining).toBe(1)
    expect(partial.pending?.options?.map((o) => o.id)).toEqual(['athletics', 'stealth'])
    expect(partial.diagnostics[0]?.code).toBe('INVALID_SELECTION')

    const complete = applySelection(definition, {
      kind: 'skill',
      skills: ['athletics', 'stealth', 'stealth'],
    })
    expect(complete.pending).toBeUndefined()
    expect(complete.grants[0]?.effects).toHaveLength(2)
  })

  it('handles ability increases with per-ability and total caps', () => {
    const definition = {
      key: 'asi',
      source,
      choice: {
        type: 'choice' as const,
        key: 'asi',
        name: 'ASI',
        count: 1,
        from: { kind: 'abilityIncrease' as const, points: 2, maxPerAbility: 2, cap: 20 },
      },
    }
    const split = applySelection(definition, {
      kind: 'abilityIncrease',
      increases: { str: 1, dex: 1 },
    })
    expect(split.grants[0]?.effects).toEqual([
      { type: 'abilityScore.bonus', ability: 'str', value: 1 },
      { type: 'abilityScore.bonus', ability: 'dex', value: 1 },
    ])
    expect(split.pending).toBeUndefined()

    const over = applySelection(definition, { kind: 'abilityIncrease', increases: { str: 3 } })
    expect(over.grants[0]?.effects).toEqual([
      { type: 'abilityScore.bonus', ability: 'str', value: 2 },
    ])
    expect(over.diagnostics.map((d) => d.code)).toEqual(['INVALID_SELECTION'])

    const unfinished = applySelection(definition, {
      kind: 'abilityIncrease',
      increases: { con: 1 },
    })
    expect(unfinished.pending?.remaining).toBe(1)
  })

  it('routes feats, content and ASI-or-feat selections', () => {
    const feat = applySelection(
      {
        key: 'f',
        source,
        choice: { type: 'choice', key: 'f', name: 'Feat', count: 1, from: { kind: 'feat' } },
      },
      { kind: 'feat', feats: ['srd-5.1:feat:grappler'] },
    )
    expect(feat.featUids).toEqual(['srd-5.1:feat:grappler'])
    expect(feat.pending).toBeUndefined()

    const spells = applySelection(
      {
        key: 's',
        source,
        choice: {
          type: 'choice',
          key: 's',
          name: 'Spells',
          count: 2,
          from: { kind: 'content', contentKind: 'spell', filter: {} },
        },
      },
      { kind: 'content', entries: ['srd-5.1:spell:bless'] },
    )
    expect(spells.contentUids).toEqual(['srd-5.1:spell:bless'])
    expect(spells.pending?.remaining).toBe(1)

    const asiOrFeat = {
      key: 'a',
      source,
      choice: {
        type: 'choice' as const,
        key: 'a',
        name: 'ASI or feat',
        count: 1,
        from: { kind: 'asiOrFeat' as const },
      },
    }
    expect(applySelection(asiOrFeat, undefined).pending?.options?.map((o) => o.id)).toEqual([
      'asi',
      'feat',
    ])
    expect(
      applySelection(asiOrFeat, { kind: 'asiOrFeat', choice: 'feat' }).pending?.remaining,
    ).toBe(1)
    expect(
      applySelection(asiOrFeat, {
        kind: 'asiOrFeat',
        choice: 'feat',
        feat: 'srd-5.1:feat:grappler',
      }).featUids,
    ).toEqual(['srd-5.1:feat:grappler'])
    const asi = applySelection(asiOrFeat, {
      kind: 'asiOrFeat',
      choice: 'asi',
      increases: { str: 2 },
    })
    expect(asi.grants[0]?.effects).toEqual([
      { type: 'abilityScore.bonus', ability: 'str', value: 2 },
    ])
    expect(asi.pending).toBeUndefined()
  })

  it('rejects a selection of the wrong kind', () => {
    const result = applySelection(
      {
        key: 'l',
        source,
        choice: {
          type: 'choice',
          key: 'l',
          name: 'Languages',
          count: 1,
          from: { kind: 'language' },
        },
      },
      { kind: 'skill', skills: ['arcana'] },
    )
    expect(result.diagnostics[0]?.message).toContain('kind "skill"')
    expect(result.pending?.remaining).toBe(1)
    expect(result.pending?.options).toBeUndefined()
  })
})
