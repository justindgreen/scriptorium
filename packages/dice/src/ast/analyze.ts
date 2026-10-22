import type { DiceNode, Node } from './types.js'
import { BUILTIN_FUNCTIONS } from './types.js'

/** Variables referenced anywhere in the tree, in first-seen order. */
export function collectVariables(node: Node, out: string[] = []): string[] {
  switch (node.type) {
    case 'variable':
      if (!out.includes(node.name)) out.push(node.name)
      break
    case 'call':
      for (const arg of node.args) collectVariables(arg, out)
      break
    case 'binary':
      collectVariables(node.left, out)
      collectVariables(node.right, out)
      break
    case 'unary':
      collectVariables(node.operand, out)
      break
    default:
      break
  }
  return out
}

/** Function names referenced, excluding the arithmetic built-ins. */
export function collectFunctions(node: Node, out: string[] = []): string[] {
  switch (node.type) {
    case 'call':
      if (!(BUILTIN_FUNCTIONS as readonly string[]).includes(node.name) && !out.includes(node.name))
        out.push(node.name)
      for (const arg of node.args) collectFunctions(arg, out)
      break
    case 'binary':
      collectFunctions(node.left, out)
      collectFunctions(node.right, out)
      break
    case 'unary':
      collectFunctions(node.operand, out)
      break
    default:
      break
  }
  return out
}

export function collectDice(node: Node, out: DiceNode[] = []): DiceNode[] {
  switch (node.type) {
    case 'dice':
      out.push(node)
      break
    case 'call':
      for (const arg of node.args) collectDice(arg, out)
      break
    case 'binary':
      collectDice(node.left, out)
      collectDice(node.right, out)
      break
    case 'unary':
      collectDice(node.operand, out)
      break
    default:
      break
  }
  return out
}

export function hasDice(node: Node): boolean {
  return collectDice(node).length > 0
}

/**
 * Multiplies the dice of every dice term (a critical hit rolls all damage dice twice).
 * Keep/drop counts scale with the dice so `2d6kh1` becomes `4d6kh2`.
 */
export function multiplyDice(node: Node, factor: number): Node {
  switch (node.type) {
    case 'dice': {
      const count = node.count * factor
      return {
        ...node,
        count,
        ...(node.keep ? { keep: { ...node.keep, count: node.keep.count * factor } } : {}),
        ...(node.drop ? { drop: { ...node.drop, count: node.drop.count * factor } } : {}),
      }
    }
    case 'call':
      return { ...node, args: node.args.map((a) => multiplyDice(a, factor)) }
    case 'binary':
      return {
        ...node,
        left: multiplyDice(node.left, factor),
        right: multiplyDice(node.right, factor),
      }
    case 'unary':
      return { ...node, operand: multiplyDice(node.operand, factor) }
    default:
      return node
  }
}

/** Smallest and largest totals a pure dice expression can produce; null when it contains variables or calls. */
export function range(node: Node): { min: number; max: number } | null {
  switch (node.type) {
    case 'number':
      return { min: node.value, max: node.value }
    case 'dice': {
      const kept = keptCount(node)
      const low = node.min ?? 1
      return { min: kept * low, max: kept * node.faces }
    }
    case 'unary': {
      const r = range(node.operand)
      return r ? { min: -r.max, max: -r.min } : null
    }
    case 'binary': {
      const a = range(node.left)
      const b = range(node.right)
      if (!a || !b) return null
      switch (node.op) {
        case '+':
          return { min: a.min + b.min, max: a.max + b.max }
        case '-':
          return { min: a.min - b.max, max: a.max - b.min }
        case '*': {
          const products = [a.min * b.min, a.min * b.max, a.max * b.min, a.max * b.max]
          return { min: Math.min(...products), max: Math.max(...products) }
        }
        case '/': {
          if (b.min <= 0 && b.max >= 0) return null
          const quotients = [a.min / b.min, a.min / b.max, a.max / b.min, a.max / b.max]
          return { min: Math.min(...quotients), max: Math.max(...quotients) }
        }
      }
      return null
    }
    default:
      return null
  }
}

export function keptCount(node: DiceNode): number {
  if (node.keep) return node.keep.count
  if (node.drop) return node.count - node.drop.count
  return node.count
}
