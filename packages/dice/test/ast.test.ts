import { describe, expect, it } from 'vitest'
import {
  collectDice,
  collectFunctions,
  collectVariables,
  format,
  hasDice,
  LIMITS,
  multiplyDice,
  parse,
  parseOrThrow,
  range,
  validate,
} from '../src/ast/index.js'

describe('dice/ast parse', () => {
  it('parses a plain dice term with defaults', () => {
    expect(parseOrThrow('d20')).toEqual({ type: 'dice', count: 1, faces: 20 })
    expect(parseOrThrow('2D6')).toEqual({ type: 'dice', count: 2, faces: 6 })
    expect(parseOrThrow('d%')).toEqual({ type: 'dice', count: 1, faces: 100 })
  })

  it('parses keep, drop, reroll and min modifiers', () => {
    expect(parseOrThrow('4d6kh3')).toMatchObject({ keep: { mode: 'highest', count: 3 } })
    expect(parseOrThrow('2d20kl1')).toMatchObject({ keep: { mode: 'lowest', count: 1 } })
    expect(parseOrThrow('4d6dl1')).toMatchObject({ drop: { mode: 'lowest', count: 1 } })
    expect(parseOrThrow('3d8dh1')).toMatchObject({ drop: { mode: 'highest', count: 1 } })
    expect(parseOrThrow('2d6ro2,1')).toMatchObject({ reroll: { values: [1, 2], once: true } })
    expect(parseOrThrow('1d6r1')).toMatchObject({ reroll: { values: [1], once: false } })
    expect(parseOrThrow('1d6min2')).toMatchObject({ min: 2 })
    expect(parseOrThrow('4d6kh3ro1min2')).toMatchObject({
      keep: { mode: 'highest', count: 3 },
      reroll: { values: [1], once: true },
      min: 2,
    })
  })

  it('respects precedence and associativity', () => {
    expect(format(parseOrThrow('1 + 2 * 3'))).toBe('1 + 2 * 3')
    expect(format(parseOrThrow('(1 + 2) * 3'))).toBe('(1 + 2) * 3')
    expect(format(parseOrThrow('10 - 4 - 3'))).toBe('10 - 4 - 3')
    expect(format(parseOrThrow('10 - (4 - 3)'))).toBe('10 - (4 - 3)')
    expect(format(parseOrThrow('8 / (2 * 2)'))).toBe('8 / (2 * 2)')
    expect(format(parseOrThrow('-(1d4 + 1)'))).toBe('-(1d4 + 1)')
    expect(format(parseOrThrow('+3'))).toBe('3')
  })

  it('parses variables, functions and quoted arguments', () => {
    const text = "1d8 + STR + table('sneak-attack', classLevel('srd-5.1:class:rogue'))"
    const ast = parseOrThrow(text)
    expect(collectVariables(ast)).toEqual(['STR'])
    expect(collectFunctions(ast)).toEqual(['table', 'classLevel'])
    expect(format(ast)).toBe(text)
    expect(parseOrThrow('max(DEX, 0)')).toEqual({
      type: 'call',
      name: 'max',
      args: [
        { type: 'variable', name: 'DEX' },
        { type: 'number', value: 0 },
      ],
    })
  })

  it('does not mistake identifiers that start with d for dice', () => {
    expect(parseOrThrow('d4')).toEqual({ type: 'dice', count: 1, faces: 4 })
    expect(parseOrThrow('DEX')).toEqual({ type: 'variable', name: 'DEX' })
    expect(parseOrThrow('dmg1')).toEqual({ type: 'variable', name: 'dmg1' })
  })

  it.each([
    ['', 'expression is empty'],
    ['   ', 'expression is empty'],
    ['1 +', 'unexpected end of expression'],
    ['(1 + 2', 'expected ")"'],
    ['1 + 2)', 'unexpected input after expression'],
    ['2 3', 'unexpected input after expression'],
    ['1d', 'unexpected input after expression'],
    ['0d6', 'dice count must be between 1 and 100'],
    ['101d6', 'dice count must be between 1 and 100'],
    ['1d1', 'dice must have between 2 and 1000 faces'],
    ['1d1001', 'dice must have between 2 and 1000 faces'],
    ['2d6kh3', 'keep count must be between 1 and the dice count'],
    ['2d6kh0', 'keep count must be between 1 and the dice count'],
    ['2d6dl2', 'drop count must leave at least one die'],
    ['4d6kh3dl1', 'only one keep or drop modifier is allowed'],
    ['1d6r7', 'reroll values must be faces of the die'],
    ['1d6r1,2,3,4,5,6', 'rerolling every face never ends'],
    ['1d6r1ro2', 'only one reroll modifier is allowed'],
    ['1d6min7', 'min must be a face of the die'],
    ['1d6 $ 2', 'unexpected character "$"'],
    ["'unterminated", 'unterminated string'],
    ["'name' + 1", 'a quoted name is only valid as a function argument'],
    ['floor(1d6', 'expected ")" after function arguments'],
    ['1 / / 2', 'unexpected token'],
  ])('rejects %j', (input, message) => {
    const result = parse(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe(message)
  })

  it('reports the position of the problem', () => {
    const result = parse('1d6 + ?')
    expect(result).toEqual({
      ok: false,
      error: { message: 'unexpected character "?"', position: 6 },
    })
    expect(() => parseOrThrow('1d6 + ?')).toThrow('unexpected character "?" (at 7)')
  })

  it('refuses overlong and deeply nested input', () => {
    expect(parse('1+'.repeat(LIMITS.maxLength) + '1').ok).toBe(false)
    const nested = '('.repeat(LIMITS.maxDepth + 1) + '1' + ')'.repeat(LIMITS.maxDepth + 1)
    expect(parse(nested)).toMatchObject({
      ok: false,
      error: { message: 'expression is nested too deeply' },
    })
    expect(parse('('.repeat(LIMITS.maxDepth) + '1' + ')'.repeat(LIMITS.maxDepth)).ok).toBe(true)
  })

  it('never throws, even on non-string input', () => {
    expect(parse(undefined as unknown as string).ok).toBe(false)
    expect(parse(42 as unknown as string).ok).toBe(false)
  })
})

describe('dice/ast analysis', () => {
  it('finds dice, variables and functions', () => {
    const ast = parseOrThrow('1d8 + 2d6 + STR + PB')
    expect(collectDice(ast).map((d) => format(d))).toEqual(['1d8', '2d6'])
    expect(hasDice(ast)).toBe(true)
    expect(hasDice(parseOrThrow('STR + 2'))).toBe(false)
    expect(collectVariables(parseOrThrow('STR + STR + DEX'))).toEqual(['STR', 'DEX'])
  })

  it('doubles dice for critical hits without touching flat modifiers', () => {
    expect(format(multiplyDice(parseOrThrow('1d8 + 3 + 2d6kh1'), 2))).toBe('2d8 + 3 + 4d6kh2')
    expect(format(multiplyDice(parseOrThrow('max(1d6, 2) - 1d4'), 2))).toBe('max(2d6, 2) - 2d4')
  })

  it('computes the range of pure dice expressions', () => {
    expect(range(parseOrThrow('2d6 + 3'))).toEqual({ min: 5, max: 15 })
    expect(range(parseOrThrow('4d6kh3'))).toEqual({ min: 3, max: 18 })
    expect(range(parseOrThrow('4d6dl1'))).toEqual({ min: 3, max: 18 })
    expect(range(parseOrThrow('1d6min2'))).toEqual({ min: 2, max: 6 })
    expect(range(parseOrThrow('-(1d4)'))).toEqual({ min: -4, max: -1 })
    expect(range(parseOrThrow('10 - 1d4'))).toEqual({ min: 6, max: 9 })
    expect(range(parseOrThrow('1d4 * 1d4'))).toEqual({ min: 1, max: 16 })
    expect(range(parseOrThrow('1d6 / 2'))).toEqual({ min: 0.5, max: 3 })
    expect(range(parseOrThrow('1d6 + STR'))).toBeNull()
    expect(range(parseOrThrow('floor(1d6 / 2)'))).toBeNull()
  })
})

describe('dice/ast validate', () => {
  const options = {
    allowedVariables: ['STR', 'DEX', 'PB'],
    allowedFunctions: ['table', 'classLevel'],
  }

  it('accepts expressions that use only allowed names', () => {
    const text = "1d8 + STR + floor(PB / 2) + table('x', classLevel('y'))"
    expect(validate(text, options)).toEqual({ ok: true })
  })

  it('reports unknown variables and functions together', () => {
    expect(validate('1d8 + CHA + magic(1)', options)).toEqual({
      ok: false,
      issues: [
        { code: 'UNKNOWN_VARIABLE', message: 'unknown variable "CHA"' },
        { code: 'UNKNOWN_FUNCTION', message: 'unknown function "magic"' },
      ],
    })
  })

  it('reports syntax errors with a position', () => {
    expect(validate('1d8 +', options)).toEqual({
      ok: false,
      issues: [{ code: 'SYNTAX', message: 'unexpected end of expression', position: 5 }],
    })
  })
})

describe('dice/ast normalize', () => {
  it('turns dice(count, faces) with constant arguments into dice terms', async () => {
    const { normalizeDice, foldConstants, expectedValue } = await import('../src/ast/index.js')
    expect(format(normalizeDice(parseOrThrow('dice(3, 6) + 2')))).toBe('3d6 + 2')
    expect(format(normalizeDice(parseOrThrow('dice(0, 6) + 2')))).toBe('0 + 2')
    expect(format(normalizeDice(parseOrThrow('dice(STR, 6)')))).toBe('dice(STR, 6)')
    expect(format(foldConstants(parseOrThrow('dice(ceil(5 / 2), 6) + (1 + 2) * 2')))).toBe(
      'dice(3, 6) + 6',
    )
    expect(format(normalizeDice(foldConstants(parseOrThrow('dice(ceil(5 / 2), 6)'))))).toBe('3d6')
    expect(expectedValue(parseOrThrow('dice(2, 6) + 1'))).toBe(8)
  })
})
