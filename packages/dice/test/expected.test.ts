import { describe, expect, it } from 'vitest'
import {
  expectedValue,
  parseOrThrow,
  singleDieDistribution,
  type DiceNode,
} from '../src/ast/index.js'

const expected = (text: string, context?: Parameters<typeof expectedValue>[1]) =>
  expectedValue(parseOrThrow(text), context)

describe('dice/ast expected value', () => {
  it('handles plain dice and arithmetic', () => {
    expect(expected('1d6')).toBe(3.5)
    expect(expected('2d6 + 3')).toBe(10)
    expect(expected('1d20')).toBe(10.5)
    expect(expected('d%')).toBe(50.5)
    expect(expected('2 * 1d8 - 1')).toBe(8)
    expect(expected('-(1d4)')).toBe(-2.5)
    expect(expected('1d6 / 2')).toBe(1.75)
  })

  it('computes keep and drop pools exactly', () => {
    expect(expected('4d6kh3')).toBeCloseTo(12.244598765432098, 12)
    expect(expected('4d6dl1')).toBeCloseTo(12.244598765432098, 12)
    expect(expected('2d20kh1')).toBeCloseTo(13.825, 12)
    expect(expected('2d20kl1')).toBeCloseTo(7.175, 12)
    expect(expected('2d20dh1')).toBeCloseTo(7.175, 12)
    expect(expected('3d6kh3')).toBeCloseTo(10.5, 12)
    // E[max of 2d6] = 161/36.
    expect(expected('2d6kh1')).toBeCloseTo(161 / 36, 12)
    // Large pools are closed-form, not enumerated; the top half of 20d6 beats 10 plain d6.
    expect(expected('20d6kh10')).toBeGreaterThan(expected('10d6')!)
    expect(expected('20d6kh10')).toBeLessThan(60)
    // E[min of n d20] = sum over v of P(min >= v) = sum of ((21 - v) / 20) ** n.
    const minOf100 = Array.from({ length: 20 }, (_, i) => ((20 - i) / 20) ** 100).reduce(
      (a, b) => a + b,
      0,
    )
    expect(expected('100d20kl1')).toBeCloseTo(minOf100, 9)
  })

  it('handles rerolls and minimums', () => {
    // Great Weapon Fighting on a d6: the well-known 4.1667.
    expect(expected('1d6ro1,2')).toBeCloseTo(150 / 36, 12)
    expect(expected('2d6ro1,2')).toBeCloseTo(300 / 36, 12)
    expect(expected('1d6ro1')).toBeCloseTo(141 / 36, 12)
    // Unlimited reroll of 1s is uniform over 2..6.
    expect(expected('1d6r1')).toBeCloseTo(4, 12)
    expect(expected('1d6min2')).toBeCloseTo(22 / 6, 12)
    expect(expected('1d6min6')).toBeCloseTo(6, 12)
  })

  it('keeps single-die distributions normalised', () => {
    for (const text of ['1d6', '1d6ro1,2', '1d6r1,2', '1d6min3', '1d20ro1min5']) {
      const dist = singleDieDistribution(parseOrThrow(text) as DiceNode)
      const total = [...dist.values()].reduce((a, b) => a + b, 0)
      expect(total).toBeCloseTo(1, 12)
    }
  })

  it('resolves variables and functions from the context', () => {
    expect(expected('1d8 + STR')).toBeNull()
    expect(expected('1d8 + STR', { variables: { STR: 3 } })).toBe(7.5)
    expect(expected('floor(PB / 2)', { variables: { PB: 3 } })).toBe(1)
    expect(expected('ceil(PB / 2)', { variables: { PB: 3 } })).toBe(2)
    expect(expected('max(DEX, 0) + min(1, 2) + abs(-3)', { variables: { DEX: -1 } })).toBe(4)
    const functions = (name: string, args: Array<number | string>) =>
      name === 'table' ? Number(args[1]) * 2 : null
    expect(expected("table('x', 5)", { functions })).toBe(10)
    expect(expected("table('x', 5)")).toBeNull()
  })

  it('returns null where no exact expectation exists', () => {
    expect(expected('floor(1d6 / 2)')).toBeNull()
    expect(expected('max(1d6, 3)')).toBeNull()
    expect(expected('10 / 1d4')).toBeNull()
    expect(expected('1 / 0')).toBeNull()
  })
})
