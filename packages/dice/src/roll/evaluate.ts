import {
  format,
  formatDice,
  multiplyDice,
  normalizeDice,
  parse,
  LIMITS,
  type DiceNode,
  type Node,
} from '../ast/index.js'
import type { DieRoller } from './rng.js'

export type DieResult = {
  value: number
  kept: boolean
  /** Values this die showed before being rerolled, oldest first. */
  rerolledFrom?: number[]
  /** The raw face when `min` raised it. */
  raisedFrom?: number
}

export type RollTerm =
  | { kind: 'dice'; notation: string; rolls: DieResult[]; subtotal: number }
  | { kind: 'number'; value: number }
  | { kind: 'variable'; name: string; value: number }
  | { kind: 'call'; name: string; value: number }

export type RollResult = {
  /** Final total, rounded down (the 5e rounding rule). */
  total: number
  /** Unrounded value. */
  value: number
  /** Canonical expression that was evaluated (after any critical doubling). */
  expression: string
  /** The expression with every die replaced by what it showed: `2d6 [4, 2] + 3`. */
  breakdown: string
  /** Every leaf in evaluation order, for structured display. */
  terms: RollTerm[]
  critical: boolean
}

export type RollContext = {
  dice: DieRoller
  variables?: Record<string, number>
  /** Resolves non-arithmetic functions (`table`, `classLevel`). Return null for unknown names. */
  functions?: (name: string, args: Array<number | string>) => number | null
  /** Roll all dice twice (critical hit damage). Flat modifiers are not doubled. */
  critical?: boolean
}

export class RollError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RollError'
  }
}

/** Evaluates a parsed expression or expression text with the given die roller. */
export function roll(input: Node | string, context: RollContext): RollResult {
  let ast: Node
  if (typeof input === 'string') {
    const parsed = parse(input)
    if (!parsed.ok) throw new RollError(`${parsed.error.message} (at ${parsed.error.position + 1})`)
    ast = parsed.ast
  } else {
    ast = input
  }
  ast = normalizeDice(ast)
  if (context.critical) ast = multiplyDice(ast, 2)
  const terms: RollTerm[] = []
  const { value, text } = evaluate(ast, context, terms)
  return {
    total: Math.floor(value),
    value,
    expression: format(ast),
    breakdown: text,
    terms,
    critical: Boolean(context.critical),
  }
}

type Evaluated = { value: number; text: string }

const PRECEDENCE: Record<'+' | '-' | '*' | '/', number> = { '+': 1, '-': 1, '*': 2, '/': 2 }

function evaluate(node: Node, context: RollContext, terms: RollTerm[]): Evaluated {
  switch (node.type) {
    case 'number':
      terms.push({ kind: 'number', value: node.value })
      return { value: node.value, text: String(node.value) }
    case 'string':
      throw new RollError('a quoted name is only valid as a function argument')
    case 'variable': {
      const value = context.variables?.[node.name]
      if (value === undefined) throw new RollError(`unknown variable "${node.name}"`)
      terms.push({ kind: 'variable', name: node.name, value })
      return { value, text: `${node.name} ${value}` }
    }
    case 'dice': {
      const term = rollDice(node, context.dice)
      terms.push(term)
      const faces = term.rolls.map((d) => `${d.kept ? '' : '~'}${d.value}`).join(', ')
      return { value: term.subtotal, text: `${term.notation} [${faces}]` }
    }
    case 'unary': {
      const inner = evaluate(node.operand, context, terms)
      const needsParens = node.operand.type === 'binary' || node.operand.type === 'unary'
      return { value: -inner.value, text: `-${needsParens ? `(${inner.text})` : inner.text}` }
    }
    case 'binary': {
      const left = evaluate(node.left, context, terms)
      const right = evaluate(node.right, context, terms)
      const precedence = PRECEDENCE[node.op]
      const text = `${wrap(node.left, left.text, precedence, false)} ${node.op} ${wrap(node.right, right.text, precedence, true)}`
      switch (node.op) {
        case '+':
          return { value: left.value + right.value, text }
        case '-':
          return { value: left.value - right.value, text }
        case '*':
          return { value: left.value * right.value, text }
        case '/':
          if (right.value === 0) throw new RollError('division by zero')
          return { value: left.value / right.value, text }
      }
      throw new RollError('unknown operator')
    }
    case 'call': {
      const parts: string[] = []
      const args: Array<number | string> = node.args.map((arg) => {
        if (arg.type === 'string') {
          parts.push(`'${arg.value}'`)
          return arg.value
        }
        const evaluated = evaluate(arg, context, [])
        parts.push(evaluated.text)
        return evaluated.value
      })
      const numbers = args.filter((a): a is number => typeof a === 'number')
      let value: number | null
      switch (node.name) {
        case 'floor':
          value = numbers.length === 1 ? Math.floor(numbers[0]!) : null
          break
        case 'ceil':
          value = numbers.length === 1 ? Math.ceil(numbers[0]!) : null
          break
        case 'abs':
          value = numbers.length === 1 ? Math.abs(numbers[0]!) : null
          break
        case 'max':
          value = numbers.length > 0 ? Math.max(...numbers) : null
          break
        case 'min':
          value = numbers.length > 0 ? Math.min(...numbers) : null
          break
        default:
          value = context.functions ? context.functions(node.name, args) : null
      }
      if (value === null || Number.isNaN(value)) {
        throw new RollError(`cannot evaluate function "${node.name}"`)
      }
      terms.push({ kind: 'call', name: node.name, value })
      return { value, text: `${node.name}(${parts.join(', ')}) ${value}` }
    }
  }
}

/** Mirrors `format`: a right operand of equal precedence and any nested unary gets parentheses. */
function wrap(node: Node, text: string, precedence: number, isRight: boolean): string {
  if (node.type === 'binary') {
    const own = PRECEDENCE[node.op]
    if (own < precedence || (isRight && own === precedence)) return `(${text})`
  }
  if (node.type === 'unary' && (isRight || precedence >= 2)) return `(${text})`
  return text
}

/** Rolls one dice term with its modifiers and records every die. */
export function rollDice(node: DiceNode, dice: DieRoller): Extract<RollTerm, { kind: 'dice' }> {
  const rolls: DieResult[] = []
  for (let i = 0; i < node.count; i += 1) {
    let value = dice(node.faces)
    const history: number[] = []
    if (node.reroll) {
      const rerolled = new Set(node.reroll.values)
      let attempts = 0
      while (rerolled.has(value) && attempts < LIMITS.maxRerolls) {
        history.push(value)
        value = dice(node.faces)
        attempts += 1
        if (node.reroll.once) break
      }
    }
    const die: DieResult = { value, kept: true }
    if (history.length > 0) die.rerolledFrom = history
    if (node.min !== undefined && value < node.min) {
      die.raisedFrom = value
      die.value = node.min
    }
    rolls.push(die)
  }
  if (node.keep || node.drop) {
    // Ties are broken by roll order, so results never depend on sort stability.
    const keepHighest = node.keep ? node.keep.mode === 'highest' : node.drop!.mode === 'lowest'
    const keepCount = node.keep ? node.keep.count : node.count - node.drop!.count
    const order = rolls
      .map((die, index) => ({ die, index }))
      .sort(
        (a, b) =>
          (keepHighest ? b.die.value - a.die.value : a.die.value - b.die.value) ||
          a.index - b.index,
      )
    order.forEach((entry, rank) => {
      entry.die.kept = rank < keepCount
    })
  }
  const subtotal = rolls.filter((d) => d.kept).reduce((sum, d) => sum + d.value, 0)
  return { kind: 'dice', notation: formatDice(node), rolls, subtotal }
}

/** Human-readable account of a roll: `2d6 [4, 2] + 3 = 9`. */
export function describe(result: RollResult): string {
  return `${result.breakdown} = ${result.total}`
}
