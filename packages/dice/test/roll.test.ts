import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '../src/ast/index.js'
import {
  createCryptoRng,
  createSeededRng,
  describe as describeRoll,
  dieRoller,
  resolveMode,
  roll,
  RollError,
  rollD20,
  scriptedDice,
} from '../src/roll/index.js'

describe('dice/roll rng', () => {
  it('seeded RNGs are deterministic and in [0, 1)', () => {
    const a = createSeededRng(7)
    const b = createSeededRng(7)
    for (let i = 0; i < 100; i += 1) {
      const value = a()
      expect(value).toBe(b())
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
    expect(createSeededRng(1)()).not.toBe(createSeededRng(2)())
  })

  it('the crypto RNG produces values in [0, 1)', () => {
    const rng = createCryptoRng()
    for (let i = 0; i < 100; i += 1) {
      const value = rng()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('die rollers map to faces 1..N', () => {
    const dice = dieRoller(createSeededRng(3))
    for (let i = 0; i < 500; i += 1) {
      const value = dice(6)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(6)
    }
    expect(() => dice(0)).toThrow('cannot roll a d0')
  })

  it('scripted dice replay values and refuse impossible ones', () => {
    const dice = scriptedDice([4, 2])
    expect(dice(6)).toBe(4)
    expect(dice.remaining()).toBe(1)
    expect(dice(6)).toBe(2)
    expect(() => dice(6)).toThrow('ran out')
    expect(() => scriptedDice([7])(6)).toThrow('not a face of d6')
  })
})

describe('dice/roll evaluate', () => {
  it('explains a simple damage roll', () => {
    const result = roll('2d6 + 3', { dice: scriptedDice([4, 2]) })
    expect(result.total).toBe(9)
    expect(result.expression).toBe('2d6 + 3')
    expect(result.terms).toEqual([
      {
        kind: 'dice',
        notation: '2d6',
        rolls: [
          { value: 4, kept: true },
          { value: 2, kept: true },
        ],
        subtotal: 6,
      },
      { kind: 'number', value: 3 },
    ])
    expect(describeRoll(result)).toBe('2d6 [4, 2] + 3 = 9')
  })

  it('marks dropped dice for keep/drop pools', () => {
    const result = roll('4d6kh3', { dice: scriptedDice([3, 1, 6, 1]) })
    expect(result.total).toBe(10)
    const term = result.terms[0]
    // Ties are broken by roll order: the first 1 is kept, the last 1 is dropped.
    expect(term?.kind === 'dice' && term.rolls.map((d) => d.kept)).toEqual([
      true,
      true,
      true,
      false,
    ])
    expect(describeRoll(result)).toBe('4d6kh3 [3, 1, 6, ~1] = 10')

    const lowest = roll('2d20kl1', { dice: scriptedDice([17, 5]) })
    expect(lowest.total).toBe(5)
    const dropHigh = roll('3d8dh1', { dice: scriptedDice([8, 2, 5]) })
    expect(dropHigh.total).toBe(7)
  })

  it('rerolls once or until a non-matching face and records history', () => {
    const once = roll('2d6ro1,2', { dice: scriptedDice([1, 2, 5, 6]) })
    expect(once.total).toBe(2 + 5)
    const term = once.terms[0]
    expect(term?.kind === 'dice' && term.rolls).toEqual([
      { value: 2, kept: true, rerolledFrom: [1] },
      { value: 5, kept: true },
    ])

    const until = roll('1d6r1', { dice: scriptedDice([1, 1, 1, 4]) })
    expect(until.total).toBe(4)
    const untilTerm = until.terms[0]
    expect(untilTerm?.kind === 'dice' && untilTerm.rolls[0]).toEqual({
      value: 4,
      kept: true,
      rerolledFrom: [1, 1, 1],
    })
  })

  it('raises dice to a minimum and records the raw face', () => {
    const result = roll('2d6min3', { dice: scriptedDice([1, 5]) })
    expect(result.total).toBe(8)
    const term = result.terms[0]
    expect(term?.kind === 'dice' && term.rolls[0]).toEqual({ value: 3, kept: true, raisedFrom: 1 })
  })

  it('doubles dice but not modifiers on a critical hit', () => {
    const result = roll('1d8 + 3', { dice: scriptedDice([8, 1]), critical: true })
    expect(result.expression).toBe('2d8 + 3')
    expect(result.breakdown).toBe('2d8 [8, 1] + 3')
    expect(result.total).toBe(12)
    expect(result.critical).toBe(true)
  })

  it('resolves variables and functions and rounds down the total', () => {
    const result = roll('1d6 + floor(level / 2) + STR', {
      dice: scriptedDice([3]),
      variables: { level: 5, STR: 2 },
    })
    expect(result.total).toBe(7)
    expect(result.breakdown).toBe('1d6 [3] + floor(level 5 / 2) 2 + STR 2')
    expect(result.terms).toEqual([
      { kind: 'dice', notation: '1d6', rolls: [{ value: 3, kept: true }], subtotal: 3 },
      { kind: 'call', name: 'floor', value: 2 },
      { kind: 'variable', name: 'STR', value: 2 },
    ])
    const half = roll('7 / 2', { dice: scriptedDice([]) })
    expect(half.value).toBe(3.5)
    expect(half.total).toBe(3)
    const custom = roll("table('sneak', 5) + 1d6", {
      dice: scriptedDice([2]),
      functions: (name, args) => (name === 'table' ? Math.ceil(Number(args[1]) / 2) : null),
    })
    expect(custom.total).toBe(5)
  })

  it('accepts a pre-parsed tree', () => {
    expect(roll(parseOrThrow('1d4 + 1'), { dice: scriptedDice([4]) }).total).toBe(5)
  })

  it('rejects malformed expressions and unresolvable names', () => {
    const dice = scriptedDice([1, 1, 1])
    expect(() => roll('1d6 +', { dice })).toThrow(RollError)
    expect(() => roll('1d6 +', { dice })).toThrow('unexpected end of expression (at 6)')
    expect(() => roll('1d6 + STR', { dice })).toThrow('unknown variable "STR"')
    expect(() => roll("table('x')", { dice })).toThrow('cannot evaluate function "table"')
    expect(() => roll('1 / 0', { dice })).toThrow('division by zero')
    expect(() => roll('floor(1, 2)', { dice })).toThrow('cannot evaluate function "floor"')
  })

  it('is reproducible with a seeded RNG', () => {
    const a = roll('8d6 + 2d4kh1', { dice: dieRoller(createSeededRng(99)) })
    const b = roll('8d6 + 2d4kh1', { dice: dieRoller(createSeededRng(99)) })
    expect(a).toEqual(b)
  })
})

describe('dice/roll d20', () => {
  it('rolls one die normally and two under advantage or disadvantage', () => {
    const normal = rollD20({ dice: scriptedDice([13]), modifier: 5 })
    expect(normal).toEqual({
      mode: 'normal',
      dice: [13],
      natural: 13,
      modifier: 5,
      total: 18,
      isCritical: false,
      isNaturalOne: false,
    })
    const advantage = rollD20({ dice: scriptedDice([4, 17]), mode: 'advantage', modifier: 2 })
    expect(advantage.dice).toEqual([4, 17])
    expect(advantage.natural).toBe(17)
    expect(advantage.total).toBe(19)
    const disadvantage = rollD20({ dice: scriptedDice([4, 17]), mode: 'disadvantage' })
    expect(disadvantage.natural).toBe(4)
  })

  it('detects criticals with a configurable range and natural ones', () => {
    expect(rollD20({ dice: scriptedDice([20]) }).isCritical).toBe(true)
    expect(rollD20({ dice: scriptedDice([19]) }).isCritical).toBe(false)
    expect(rollD20({ dice: scriptedDice([19]), critRange: 19 }).isCritical).toBe(true)
    const one = rollD20({ dice: scriptedDice([1]), modifier: 11 })
    expect(one.isNaturalOne).toBe(true)
    expect(one.total).toBe(12)
  })

  it('cancels advantage against disadvantage', () => {
    expect(resolveMode(0, 0)).toBe('normal')
    expect(resolveMode(2, 0)).toBe('advantage')
    expect(resolveMode(0, 1)).toBe('disadvantage')
    expect(resolveMode(3, 1)).toBe('normal')
  })
})

describe('dice/roll scaled dice', () => {
  it('rolls dice(count, faces) like an ordinary term', () => {
    const result = roll('dice(2, 6) + 1', { dice: scriptedDice([3, 4]) })
    expect(result.expression).toBe('2d6 + 1')
    expect(result.total).toBe(8)
    expect(() => roll('dice(STR, 6)', { dice: scriptedDice([]) })).toThrow('unknown variable "STR"')
    expect(() => roll('dice(1, 6, 1)', { dice: scriptedDice([]) })).toThrow(
      'cannot evaluate function "dice"',
    )
  })
})
