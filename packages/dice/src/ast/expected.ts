import { keptCount } from './analyze.js'
import { normalizeDice } from './normalize.js'
import type { DiceNode, Node } from './types.js'

export type ExpectedContext = {
  variables?: Record<string, number>
  /** Resolves non-arithmetic functions (`table`, `classLevel`) to numbers; return null when unknown. */
  functions?: (name: string, args: Array<number | string>) => number | null
}

/**
 * Exact expected value of an expression, or null when it cannot be computed exactly: unknown
 * variables or functions, dice inside non-linear functions (floor, max, ...), division by a dice
 * expression. Never rolls anything.
 */
export function expectedValue(node: Node, context: ExpectedContext = {}): number | null {
  return expectedOf(normalizeDice(node), context)
}

function expectedOf(node: Node, context: ExpectedContext): number | null {
  switch (node.type) {
    case 'number':
      return node.value
    case 'string':
      return null
    case 'variable':
      return context.variables?.[node.name] ?? null
    case 'dice':
      return expectedDice(node)
    case 'unary': {
      const v = expectedOf(node.operand, context)
      return v === null ? null : -v
    }
    case 'binary': {
      const a = expectedOf(node.left, context)
      const b = expectedOf(node.right, context)
      if (a === null || b === null) return null
      switch (node.op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b // dice terms are independent
        case '/':
          return hasDiceNode(node.right) || b === 0 ? null : a / b
      }
      return null
    }
    case 'call': {
      // A non-linear function of a random quantity has no closed-form expectation here.
      if (node.args.some(hasDiceNode)) return null
      const values: Array<number | string> = []
      for (const arg of node.args) {
        if (arg.type === 'string') {
          values.push(arg.value)
          continue
        }
        const v = expectedOf(arg, context)
        if (v === null) return null
        values.push(v)
      }
      const numbers = values.filter((v): v is number => typeof v === 'number')
      switch (node.name) {
        case 'floor':
          return numbers.length === 1 ? Math.floor(numbers[0]!) : null
        case 'ceil':
          return numbers.length === 1 ? Math.ceil(numbers[0]!) : null
        case 'abs':
          return numbers.length === 1 ? Math.abs(numbers[0]!) : null
        case 'max':
          return numbers.length > 0 ? Math.max(...numbers) : null
        case 'min':
          return numbers.length > 0 ? Math.min(...numbers) : null
        default:
          return context.functions?.(node.name, values) ?? null
      }
    }
  }
}

function hasDiceNode(node: Node): boolean {
  switch (node.type) {
    case 'dice':
      return true
    case 'call':
      return node.args.some(hasDiceNode)
    case 'binary':
      return hasDiceNode(node.left) || hasDiceNode(node.right)
    case 'unary':
      return hasDiceNode(node.operand)
    default:
      return false
  }
}

/** Probability distribution of a single die after reroll and min modifiers: value -> probability. */
export function singleDieDistribution(node: DiceNode): Map<number, number> {
  const faces = node.faces
  const uniform = 1 / faces
  let dist = new Map<number, number>()
  for (let v = 1; v <= faces; v += 1) dist.set(v, uniform)

  if (node.reroll) {
    const rerolled = new Set(node.reroll.values)
    const pReroll = rerolled.size / faces
    const next = new Map<number, number>()
    for (let v = 1; v <= faces; v += 1) {
      if (rerolled.has(v)) continue
      if (node.reroll.once) {
        // Kept on the first roll with probability 1/faces, or reached after one reroll.
        next.set(v, uniform + pReroll * uniform)
      } else {
        next.set(v, 1 / (faces - rerolled.size))
      }
    }
    if (node.reroll.once) {
      // A rerolled die may land on a rerolled face again and then stands.
      for (const v of rerolled) next.set(v, pReroll * uniform)
    }
    dist = next
  }

  if (node.min !== undefined) {
    const floor = node.min
    const next = new Map<number, number>()
    for (const [v, p] of dist) {
      const w = Math.max(v, floor)
      next.set(w, (next.get(w) ?? 0) + p)
    }
    dist = next
  }
  return dist
}

export function expectedDice(node: DiceNode): number {
  const dist = singleDieDistribution(node)
  const single = [...dist].reduce((sum, [v, p]) => sum + v * p, 0)
  if (!node.keep && !node.drop) return node.count * single

  // Keep/drop: sum the expectations of the kept order statistics. With n dice sorted ascending,
  // "keep highest k" keeps positions n-k+1..n and "keep lowest k" keeps 1..k.
  const n = node.count
  const k = keptCount(node)
  const keepHighest = node.keep ? node.keep.mode === 'highest' : node.drop!.mode === 'lowest'
  const first = keepHighest ? n - k + 1 : 1
  const values = [...dist.keys()].sort((a, b) => a - b)
  let expectation = 0
  for (let j = first; j < first + k; j += 1) {
    let cumulative = 0
    let previous = 0
    for (const v of values) {
      cumulative += dist.get(v)!
      const current = atLeastJOfN(cumulative, j, n)
      expectation += v * (current - previous)
      previous = current
    }
  }
  return expectation
}

/** P(at least j of n independent trials succeed) when each succeeds with probability p. */
function atLeastJOfN(p: number, j: number, n: number): number {
  let total = 0
  for (let i = j; i <= n; i += 1) total += binomial(n, i) * p ** i * (1 - p) ** (n - i)
  return Math.min(1, total)
}

function binomial(n: number, k: number): number {
  let result = 1
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i
  return result
}
