import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  expectedDice,
  format,
  keptCount,
  parse,
  parseOrThrow,
  range,
  type DiceNode,
  type Node,
} from '../src/ast/index.js'
import { createSeededRng, dieRoller, roll, rollDice, scriptedDice } from '../src/roll/index.js'

type KeepDropKind = 'kh' | 'kl' | 'dh' | 'dl'

const diceArb: fc.Arbitrary<DiceNode> = fc
  .record({
    count: fc.integer({ min: 1, max: 8 }),
    faces: fc.constantFrom(2, 4, 6, 8, 10, 12, 20, 100),
    keepDrop: fc.option(
      fc.record({
        kind: fc.constantFrom<KeepDropKind>('kh', 'kl', 'dh', 'dl'),
        n: fc.integer({ min: 1, max: 8 }),
      }),
      { nil: undefined },
    ),
    reroll: fc.option(
      fc.record({
        values: fc.uniqueArray(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 2 }),
        once: fc.boolean(),
      }),
      { nil: undefined },
    ),
    min: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
  })
  .map(({ count, faces, keepDrop, reroll, min }) => {
    const node: DiceNode = { type: 'dice', count, faces }
    if (keepDrop) {
      const keeping = keepDrop.kind.startsWith('k')
      const n = Math.max(1, Math.min(keepDrop.n, keeping ? count : count - 1))
      if (keeping) node.keep = { mode: keepDrop.kind === 'kh' ? 'highest' : 'lowest', count: n }
      else if (count > 1) {
        node.drop = { mode: keepDrop.kind === 'dh' ? 'highest' : 'lowest', count: n }
      }
    }
    if (reroll) {
      // Reroll values must be faces of the die, and an unlimited reroll must leave a face.
      const values = [...new Set(reroll.values)].filter((v) => v < faces).sort((a, b) => a - b)
      if (values.length > 0) node.reroll = { values, once: reroll.once }
    }
    if (min !== undefined && min <= faces) node.min = min
    return node
  })

type Op = '+' | '-' | '*' | '/'

const { tree: nodeArb } = fc.letrec<{ tree: Node }>((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.integer({ min: 0, max: 50 }).map<Node>((value) => ({ type: 'number', value })),
    diceArb,
    fc.constantFrom('STR', 'DEX', 'PB', 'level').map<Node>((name) => ({ type: 'variable', name })),
    fc
      .tuple(fc.constantFrom<Op>('+', '-', '*', '/'), tie('tree'), tie('tree'))
      .map<Node>(([op, left, right]) => ({ type: 'binary', op, left, right })),
    tie('tree').map<Node>((operand) => ({ type: 'unary', op: '-', operand })),
    fc
      .tuple(
        fc.constantFrom('floor', 'ceil', 'max', 'min'),
        fc.array(tie('tree'), { minLength: 1, maxLength: 2 }),
      )
      .map<Node>(([name, args]) => ({ type: 'call', name, args })),
  ),
}))

describe('dice properties', () => {
  it('format then parse yields the same tree', () => {
    fc.assert(
      fc.property(nodeArb, (node) => {
        const text = format(node)
        const parsed = parse(text)
        if (!parsed.ok) return text.length > 200 // only overlong output may fail to parse
        expect(format(parsed.ast)).toBe(text)
        return true
      }),
      { numRuns: 500 },
    )
  })

  it('parse never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (text) => {
        const result = parse(text)
        expect(typeof result.ok).toBe('boolean')
      }),
      { numRuns: 1000 },
    )
  })

  it('rolled dice stay inside the static range and keep the right number of dice', () => {
    fc.assert(
      fc.property(diceArb, fc.integer(), (node, seed) => {
        const term = rollDice(node, dieRoller(createSeededRng(seed)))
        const bounds = range(node)!
        expect(term.subtotal).toBeGreaterThanOrEqual(bounds.min)
        expect(term.subtotal).toBeLessThanOrEqual(bounds.max)
        expect(term.rolls).toHaveLength(node.count)
        expect(term.rolls.filter((d) => d.kept)).toHaveLength(keptCount(node))
        const keptSum = term.rolls.filter((d) => d.kept).reduce((s, d) => s + d.value, 0)
        expect(term.subtotal).toBe(keptSum)
        for (const die of term.rolls) {
          expect(die.value).toBeGreaterThanOrEqual(node.min ?? 1)
          expect(die.value).toBeLessThanOrEqual(node.faces)
          if (node.reroll?.once) expect(die.rerolledFrom?.length ?? 0).toBeLessThanOrEqual(1)
          if (node.reroll && !node.reroll.once) {
            expect(node.reroll.values).not.toContain(die.raisedFrom ?? die.value)
          }
        }
      }),
      { numRuns: 500 },
    )
  })

  it('the exact expectation matches brute-force enumeration for small pools', () => {
    const small = diceArb.filter((n) => n.count <= 3 && n.faces <= 8 && !n.reroll)
    fc.assert(
      fc.property(small, (node) => {
        const outcomes: number[] = []
        const values = Array.from({ length: node.faces }, (_, i) => i + 1)
        const walk = (prefix: number[]) => {
          if (prefix.length === node.count) {
            outcomes.push(rollDice(node, scriptedDice(prefix)).subtotal)
            return
          }
          for (const v of values) walk([...prefix, v])
        }
        walk([])
        const bruteForce = outcomes.reduce((a, b) => a + b, 0) / outcomes.length
        expect(expectedDice(node)).toBeCloseTo(bruteForce, 9)
      }),
      { numRuns: 200 },
    )
  })

  it('seeded rolls of the same expression are reproducible and sit inside the range', () => {
    fc.assert(
      fc.property(fc.array(diceArb, { minLength: 1, maxLength: 3 }), fc.integer(), (dice, seed) => {
        const text = dice.map((d) => format(d)).join(' + ')
        const a = roll(text, { dice: dieRoller(createSeededRng(seed)) })
        const b = roll(text, { dice: dieRoller(createSeededRng(seed)) })
        expect(a).toEqual(b)
        const bounds = range(parseOrThrow(text))!
        expect(a.total).toBeGreaterThanOrEqual(bounds.min)
        expect(a.total).toBeLessThanOrEqual(bounds.max)
      }),
      { numRuns: 300 },
    )
  })
})
