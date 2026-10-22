import { describe, expect, it } from 'vitest'
import {
  applyPackets,
  applyRolls,
  monsterDefenses,
  parseDefenseText,
  type ActionPlan,
  type DamagePacket,
  type PacketFlags,
} from '../src/index.js'

const flags = (overrides: Partial<PacketFlags> = {}): PacketFlags => ({
  magical: false,
  silvered: false,
  adamantine: false,
  fromSpell: false,
  weapon: true,
  ...overrides,
})

const packet = (
  id: string,
  amount: number,
  damageType: string,
  f: Partial<PacketFlags> = {},
): DamagePacket => ({
  id,
  label: id,
  amount,
  damageType,
  flags: flags(f),
})

describe('monster defenses', () => {
  it('reads plain types and the nonmagical-weapon clauses', () => {
    const skeleton = monsterDefenses({
      damageVulnerabilities: ['bludgeoning'],
      damageResistances: [],
      damageImmunities: ['poison'],
    })
    expect(skeleton.unparsed).toEqual([])
    expect(skeleton.defenses).toEqual([
      { kind: 'vulnerability', damageType: 'bludgeoning' },
      { kind: 'immunity', damageType: 'poison' },
    ])

    const werewolf = parseDefenseText(
      'immunity',
      "bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered",
    )
    expect(werewolf.unparsed).toBeUndefined()
    expect(werewolf.defenses.map((d) => d.damageType)).toEqual([
      'bludgeoning',
      'piercing',
      'slashing',
    ])
    expect(werewolf.defenses[0]?.condition).toEqual({
      not: { any: [{ leaf: 'packet.magical' }, { leaf: 'packet.silvered' }] },
    })

    const spells = parseDefenseText('resistance', 'damage from spells')
    expect(spells.defenses).toHaveLength(13)
    expect(spells.defenses[0]?.condition).toEqual({ leaf: 'packet.fromSpell' })

    expect(parseDefenseText('resistance', 'fire, cold').defenses.map((d) => d.damageType)).toEqual([
      'fire',
      'cold',
    ])
    expect(
      parseDefenseText('resistance', 'piercing from magic weapons wielded by good creatures')
        .unparsed,
    ).toBeDefined()
  })
})

describe('applyPackets', () => {
  it('doubles against vulnerability, ignores immunity, halves resistance once', () => {
    const skeleton = monsterDefenses({
      damageVulnerabilities: ['bludgeoning'],
      damageResistances: [],
      damageImmunities: ['poison'],
    }).defenses
    const result = applyPackets(skeleton, { hpCurrent: 13, hpTemp: 0 }, [
      packet('mace', 7, 'bludgeoning'),
      packet('venom', 5, 'poison'),
    ])
    expect(result.packets).toEqual([
      { id: 'mace', damageType: 'bludgeoning', amount: 7, taken: 14, modifiers: ['vulnerability'] },
      { id: 'venom', damageType: 'poison', amount: 5, taken: 0, modifiers: ['immunity'] },
    ])
    expect(result.damageTaken).toBe(14)
    expect(result.state).toEqual({ hpCurrent: 0, hpTemp: 0 })

    const werewolf = parseDefenseText(
      'immunity',
      "bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered",
    ).defenses
    expect(
      applyPackets(werewolf, { hpCurrent: 58, hpTemp: 0 }, [packet('club', 9, 'bludgeoning')])
        .damageTaken,
    ).toBe(0)
    expect(
      applyPackets(werewolf, { hpCurrent: 58, hpTemp: 0 }, [
        packet('club', 9, 'bludgeoning', { silvered: true }),
      ]).damageTaken,
    ).toBe(9)
    expect(
      applyPackets(werewolf, { hpCurrent: 58, hpTemp: 0 }, [
        packet('club', 9, 'bludgeoning', { magical: true }),
      ]).damageTaken,
    ).toBe(9)

    const both = [
      { kind: 'resistance' as const, damageType: 'fire' },
      { kind: 'resistance' as const, damageType: 'fire', note: 'second source does not stack' },
      { kind: 'vulnerability' as const, damageType: 'fire' },
    ]
    expect(
      applyPackets(both, { hpCurrent: 20, hpTemp: 0 }, [packet('fire', 11, 'fire')]).packets[0],
    ).toMatchObject({ taken: 10, modifiers: ['resistance', 'vulnerability'] })
  })

  it('spends temporary hit points first and never goes below zero', () => {
    const result = applyPackets([], { hpCurrent: 10, hpTemp: 5 }, [
      packet('a', 8, 'fire'),
      packet('b', 20, 'cold'),
    ])
    expect(result.tempAbsorbed).toBe(5)
    expect(result.state).toEqual({ hpCurrent: 0, hpTemp: 0 })
    expect(result.damageTaken).toBe(28)
  })

  it('consults static facts for conditional defenses on characters', () => {
    const defenses = [
      {
        kind: 'resistance' as const,
        damageType: 'slashing',
        condition: { leaf: 'toggle' as const, id: 'rage' },
      },
    ]
    expect(
      applyPackets(defenses, { hpCurrent: 30, hpTemp: 0 }, [packet('axe', 10, 'slashing')])
        .damageTaken,
    ).toBe(10)
    expect(
      applyPackets(
        defenses,
        { hpCurrent: 30, hpTemp: 0 },
        [packet('axe', 10, 'slashing')],
        () => true,
      ).damageTaken,
    ).toBe(5)
  })
})

describe('applyRolls', () => {
  const plan: ActionPlan = {
    ref: { kind: 'unarmed' },
    name: 'Unarmed Strike',
    actionType: 'action',
    economy: { kind: 'action', available: true },
    attack: {
      attackType: 'melee',
      bonus: 5,
      breakdown: [],
      mode: 'normal',
      advantageSources: [],
      disadvantageSources: [],
      critRange: 19,
      proficient: true,
    },
    damage: [
      {
        id: 'unarmed',
        label: 'Unarmed Strike',
        formula: '4',
        critFormula: '4',
        damageType: 'bludgeoning',
        source: { kind: 'engine', name: 'Engine', path: 'engine', order: 0 },
        optional: false,
        flags: flags(),
      },
      {
        id: 'sneak-attack',
        label: 'Sneak Attack',
        formula: '3d6',
        critFormula: '6d6',
        damageType: 'bludgeoning',
        source: { kind: 'engine', name: 'Engine', path: 'engine', order: 0 },
        optional: false,
        oncePerTurnKey: 'sneak-attack',
        flags: flags(),
      },
    ],
    excluded: [],
    costs: [],
    riders: [],
    questions: [],
    assumptions: [],
    oncePerTurnKeys: ['sneak-attack'],
    diagnostics: [],
  }

  it('decides hits from the natural roll, the total and the target AC', () => {
    const hit = applyRolls(
      plan,
      { attack: { natural: 12 }, damage: { unarmed: 4, 'sneak-attack': 10 } },
      { targetAc: 17 },
    )
    expect(hit.attack).toEqual({
      natural: 12,
      total: 17,
      critical: false,
      naturalOne: false,
      hit: true,
      targetAc: 17,
    })
    expect(hit.packets.map((p) => p.amount)).toEqual([4, 10])
    expect(hit.oncePerTurnMarks).toEqual(['sneak-attack'])
    expect(hit.economyMark).toBe('action')

    const miss = applyRolls(
      plan,
      { attack: { natural: 11 }, damage: { unarmed: 4, 'sneak-attack': 10 } },
      { targetAc: 17 },
    )
    expect(miss.attack?.hit).toBe(false)
    expect(miss.packets).toEqual([])
    expect(miss.oncePerTurnMarks).toEqual([])

    const crit = applyRolls(
      plan,
      { attack: { natural: 19 }, damage: { unarmed: 4, 'sneak-attack': 22 } },
      { targetAc: 30 },
    )
    expect(crit.attack?.critical).toBe(true)
    expect(crit.attack?.hit).toBe(true)

    const one = applyRolls(plan, {
      attack: { natural: 1 },
      damage: { unarmed: 4, 'sneak-attack': 10 },
    })
    expect(one.attack?.hit).toBe(false)

    const unknown = applyRolls(plan, {
      attack: { natural: 10 },
      damage: { unarmed: 4, 'sneak-attack': 10 },
    })
    expect(unknown.attack?.hit).toBeNull()
    expect(unknown.packets).toHaveLength(2)
  })

  it('refuses to guess missing rolls or blocked plans', () => {
    expect(() => applyRolls(plan, { damage: {} })).toThrow('attack roll is missing')
    expect(() => applyRolls(plan, { attack: { natural: 15 }, damage: { unarmed: 4 } })).toThrow(
      'damage roll for "Sneak Attack"',
    )
    expect(() => applyRolls({ ...plan, blocked: 'no' }, { attack: { natural: 15 } })).toThrow(
      'blocked',
    )
  })
})
