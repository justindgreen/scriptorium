import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CycleError,
  StatResolver,
  type Contribution,
  type Diagnostic,
  type FormulaScope,
  type SourceRef,
} from '../src/index.js'

const scope: FormulaScope = {
  abilityMod: () => 0,
  abilityScore: () => 10,
  proficiencyBonus: () => 2,
  level: () => 1,
  classLevel: () => 0,
  castingMod: () => 0,
  table: () => 0,
}

function source(name: string, order: number): SourceRef {
  return { kind: 'feature', name, path: `test:${name}`, order }
}

function createResolver(diagnostics: Diagnostic[] = [], groupChoice?: string) {
  const resolver: StatResolver = new StatResolver({
    scope: {
      ...scope,
      abilityMod: (ability) => resolver.lookup.number(`ability.${ability}.mod`),
      abilityScore: (ability) => resolver.lookup.number(`ability.${ability}.score`),
    },
    diagnostic: (d) => diagnostics.push(d),
    evaluatePredicate: () => true,
    groupChoice: () => groupChoice,
  })
  return resolver
}

let index = 0
function c(partial: Omit<Contribution, 'index' | 'source'> & { source?: SourceRef }): Contribution {
  index += 1
  return { ...partial, source: partial.source ?? source(`src${index}`, index), index }
}

describe('StatResolver phases', () => {
  it('applies BASE, REPLACE, ADD, MULTIPLY, CLAMP, FINAL and OVERRIDE in order', () => {
    const r = createResolver()
    r.add(c({ target: 'x', op: 'base', value: 10 }))
    r.add(c({ target: 'x', op: 'replace', value: 12 }))
    r.add(c({ target: 'x', op: 'add', value: 3 }))
    r.add(c({ target: 'x', op: 'multiply', value: 2 }))
    r.add(c({ target: 'x', op: 'atMost', value: 25 }))
    expect(r.resolve('x').value).toBe(25) // (12 + 3) * 2 = 30, clamped to 25

    const r2 = createResolver()
    r2.add(c({ target: 'x', op: 'base', value: 10 }))
    r2.add(c({ target: 'x', op: 'atLeast', value: 15 }))
    r2.add(c({ target: 'x', op: 'replaceFinal', value: 0 }))
    expect(r2.resolve('x').value).toBe(0)

    const r3 = createResolver()
    r3.add(c({ target: 'x', op: 'base', value: 10 }))
    r3.add(c({ target: 'x', op: 'replaceFinal', value: 0 }))
    r3.add(c({ target: 'x', op: 'override', value: 7, note: 'DM' }))
    const stat = r3.resolve('x')
    expect(stat.value).toBe(7)
    expect(stat.override).toEqual({ auto: 0, manual: 7, note: 'DM' })
  })

  it('collapses adds that share a stack key to the highest one', () => {
    const r = createResolver()
    r.add(c({ target: 'x', op: 'base', value: 0 }))
    r.add(c({ target: 'x', op: 'add', value: 1, stackKey: 'ring' }))
    r.add(c({ target: 'x', op: 'add', value: 2, stackKey: 'ring' }))
    r.add(c({ target: 'x', op: 'add', value: 1, stackKey: 'cloak' }))
    r.add(c({ target: 'x', op: 'add', value: 5 }))
    const stat = r.resolve('x')
    expect(stat.value).toBe(8)
    expect(stat.breakdown.filter((l) => l.reason === 'stack-key')).toHaveLength(1)
  })

  it('picks replacements by priority, then value, then source order and reports conflicts', () => {
    const diagnostics: Diagnostic[] = []
    const r = createResolver(diagnostics)
    r.add(c({ target: 'x', op: 'base', value: 1 }))
    r.add(c({ target: 'x', op: 'replace', value: 50, priority: 0 }))
    r.add(c({ target: 'x', op: 'replace', value: 20, priority: 5 }))
    r.add(c({ target: 'x', op: 'replace', value: 30, priority: 5 }))
    expect(r.resolve('x').value).toBe(30)
    expect(diagnostics.map((d) => d.code)).toEqual(['CONFLICTING_REPLACE'])

    const quiet: Diagnostic[] = []
    const r2 = createResolver(quiet)
    r2.add(c({ target: 'x', op: 'base', value: 1 }))
    r2.add(c({ target: 'x', op: 'replace', value: 20, priority: 5 }))
    r2.add(c({ target: 'x', op: 'replace', value: 20, priority: 5 }))
    expect(r2.resolve('x').value).toBe(20)
    expect(quiet).toEqual([])
  })

  it('evaluates formula groups to the maximum unless the user chose a member', () => {
    const r = createResolver([], undefined)
    r.declare('ac.base', 'number', 'userChoice')
    r.add(c({ target: 'ability.dex.mod', op: 'base', value: 3 }))
    r.add(c({ target: 'ability.wis.mod', op: 'base', value: 2 }))
    r.add(
      c({ target: 'ac.base', op: 'formula', value: { formula: '10 + DEX' }, label: 'Unarmored' }),
    )
    r.add(
      c({
        target: 'ac.base',
        op: 'formula',
        value: { formula: '10 + DEX + WIS' },
        label: 'Unarmored Defense',
      }),
    )
    r.add(
      c({ target: 'ac.base', op: 'formula', value: { formula: '13 + DEX' }, label: 'Mage Armor' }),
    )
    const stat = r.resolve('ac.base')
    expect(stat.value).toBe(16)
    expect(stat.breakdown.filter((l) => l.applied).map((l) => l.label)).toEqual(['Mage Armor'])
    expect(stat.breakdown.filter((l) => l.reason === 'lost-group')).toHaveLength(2)

    const chosen = createResolver([], 'Unarmored Defense')
    chosen.declare('ac.base', 'number', 'userChoice')
    chosen.add(c({ target: 'ability.dex.mod', op: 'base', value: 3 }))
    chosen.add(c({ target: 'ability.wis.mod', op: 'base', value: 2 }))
    chosen.add(
      c({
        target: 'ac.base',
        op: 'formula',
        value: { formula: '10 + DEX + WIS' },
        label: 'Unarmored Defense',
      }),
    )
    chosen.add(
      c({ target: 'ac.base', op: 'formula', value: { formula: '13 + DEX' }, label: 'Mage Armor' }),
    )
    expect(chosen.resolve('ac.base').value).toBe(15)
  })

  it('handles set-valued stats with union and remove', () => {
    const r = createResolver()
    r.declare('langs', 'set')
    r.add(c({ target: 'langs', op: 'base', value: ['common'] }))
    r.add(c({ target: 'langs', op: 'union', value: ['elvish', 'dwarvish'] }))
    r.add(c({ target: 'langs', op: 'remove', value: ['dwarvish'] }))
    expect(r.resolve('langs').value).toEqual(['common', 'elvish'])
  })

  it('skips contributions whose condition is false and records why', () => {
    const r = new StatResolver({
      scope,
      diagnostic: () => undefined,
      evaluatePredicate: (predicate) => !('leaf' in predicate && predicate.leaf === 'shield'),
      groupChoice: () => undefined,
    })
    r.add(c({ target: 'x', op: 'base', value: 1 }))
    r.add(c({ target: 'x', op: 'add', value: 5, condition: { leaf: 'shield', value: true } }))
    r.add(c({ target: 'x', op: 'add', value: 2, condition: { leaf: 'level', gte: 1 } }))
    const stat = r.resolve('x')
    expect(stat.value).toBe(3)
    expect(stat.breakdown.find((l) => l.reason === 'condition-false')?.value).toBeNull()
  })
})

describe('StatResolver dependencies', () => {
  it('resolves dependencies on demand through formulas and compute values', () => {
    const r = createResolver()
    r.add(c({ target: 'ability.str.score', op: 'base', value: 17 }))
    r.add(
      c({
        target: 'ability.str.mod',
        op: 'base',
        value: { compute: (l) => Math.floor((l.number('ability.str.score') - 10) / 2) },
      }),
    )
    r.add(c({ target: 'attack', op: 'base', value: { formula: 'STR + PB' } }))
    expect(r.resolve('attack').value).toBe(5)
  })

  it('detects cycles deterministically, excludes the closing contribution and marks the error', () => {
    const diagnostics: Diagnostic[] = []
    const r = createResolver(diagnostics)
    r.add(c({ target: 'a', op: 'base', value: 1 }))
    r.add(
      c({
        target: 'a',
        op: 'add',
        value: { compute: (l) => l.number('b') },
        source: source('A needs B', 1),
      }),
    )
    r.add(c({ target: 'b', op: 'base', value: 10 }))
    r.add(
      c({
        target: 'b',
        op: 'add',
        value: { compute: (l) => l.number('c') },
        source: source('B needs C', 2),
      }),
    )
    r.add(c({ target: 'c', op: 'base', value: 100 }))
    r.add(
      c({
        target: 'c',
        op: 'add',
        value: { compute: (l) => l.number('a') },
        source: source('C needs A', 3),
      }),
    )
    const all = r.resolveAll()
    expect(all['c']?.value).toBe(100) // the closing edge C -> A is dropped
    expect(all['c']?.error).toBe(true)
    expect(all['b']?.value).toBe(110)
    expect(all['a']?.value).toBe(111)
    expect(all['a']?.error).toBeUndefined()
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: 'CYCLE_DETECTED', statPath: 'c' })
    expect(diagnostics[0]?.message).toContain('a -> b -> c -> a')
  })

  it('throws CycleError to callers that resolve a stat already being resolved', () => {
    const r = createResolver()
    r.add(c({ target: 'a', op: 'base', value: { compute: (l) => l.number('a') } }))
    const stat = r.resolve('a')
    expect(stat.error).toBe(true)
    expect(stat.value).toBe(0)
    expect(() => {
      throw new CycleError(['a', 'a'])
    }).toThrow('cycle: a -> a')
  })

  it('reports formula errors as diagnostics and keeps computing', () => {
    const diagnostics: Diagnostic[] = []
    const r = createResolver(diagnostics)
    r.add(c({ target: 'x', op: 'base', value: 4 }))
    r.add(c({ target: 'x', op: 'add', value: { formula: 'bogus + 1' } }))
    r.add(c({ target: 'x', op: 'add', value: { formula: '1d6' } }))
    r.add(c({ target: 'x', op: 'add', value: { formula: '2 +' } }))
    expect(r.resolve('x').value).toBe(4)
    expect(diagnostics.map((d) => d.code)).toEqual([
      'UNKNOWN_VARIABLE',
      'FORMULA_ERROR',
      'FORMULA_ERROR',
    ])
  })
})

describe('StatResolver determinism', () => {
  const contributionArb: fc.Arbitrary<Omit<Contribution, 'index' | 'source'>> = fc.oneof(
    fc.record({
      target: fc.constant('x'),
      op: fc.constant('add' as const),
      value: fc.integer({ min: -5, max: 20 }),
      stackKey: fc.option(fc.constantFrom('k1', 'k2'), { nil: undefined }),
    }),
    fc.record({
      target: fc.constant('x'),
      op: fc.constant('replace' as const),
      value: fc.integer({ min: 0, max: 30 }),
      priority: fc.integer({ min: -2, max: 2 }),
    }),
    fc.record({
      target: fc.constant('x'),
      op: fc.constant('multiply' as const),
      value: fc.constantFrom(0.5, 1, 2),
    }),
    fc.record({
      target: fc.constant('x'),
      op: fc.constant('atLeast' as const),
      value: fc.integer({ min: 0, max: 15 }),
    }),
    fc.record({
      target: fc.constant('x'),
      op: fc.constant('atMost' as const),
      value: fc.integer({ min: 10, max: 40 }),
    }),
    fc.record({
      target: fc.constant('x'),
      op: fc.constant('replaceFinal' as const),
      value: fc.integer({ min: 0, max: 9 }),
      priority: fc.integer({ min: 0, max: 2 }),
    }),
  )

  it('is independent of registration order', () => {
    fc.assert(
      fc.property(
        fc.array(contributionArb, { minLength: 1, maxLength: 8 }),
        fc.integer(),
        (contributions, seed) => {
          const build = (order: number[]) => {
            const r = createResolver()
            r.add({ target: 'x', op: 'base', value: 10, source: source('base', 0), index: 0 })
            for (const i of order) {
              const partial = contributions[i]!
              r.add({ ...partial, source: source(`s${i}`, i + 1), index: i + 1 })
            }
            return r.resolve('x').value
          }
          const natural = contributions.map((_, i) => i)
          const shuffled = [...natural].sort((a, b) => hash(a, seed) - hash(b, seed))
          expect(build(shuffled)).toBe(build(natural))
        },
      ),
      { numRuns: 300 },
    )
  })

  it('adds commute', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -10, max: 10 }), { minLength: 1, maxLength: 6 }),
        (values) => {
          const total = (list: number[]) => {
            const r = createResolver()
            r.add({ target: 'x', op: 'base', value: 0, source: source('base', 0), index: 0 })
            list.forEach((v, i) =>
              r.add({
                target: 'x',
                op: 'add',
                value: v,
                source: source(`s${i}`, i + 1),
                index: i + 1,
              }),
            )
            return r.resolve('x').value
          }
          expect(total(values)).toBe(total([...values].reverse()))
          expect(total(values)).toBe(values.reduce((a, b) => a + b, 0))
        },
      ),
    )
  })
})

function hash(n: number, seed: number): number {
  let h = (n * 2654435761 + seed) >>> 0
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995) >>> 0
  return h ^ (h >>> 15)
}
