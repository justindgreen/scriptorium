import type { DiceNode, Node } from './types.js'

const PRECEDENCE: Record<'+' | '-' | '*' | '/', number> = { '+': 1, '-': 1, '*': 2, '/': 2 }

export function formatDice(node: DiceNode): string {
  let out = `${node.count}d${node.faces}`
  if (node.keep) out += `${node.keep.mode === 'highest' ? 'kh' : 'kl'}${node.keep.count}`
  if (node.drop) out += `${node.drop.mode === 'highest' ? 'dh' : 'dl'}${node.drop.count}`
  if (node.reroll) out += `${node.reroll.once ? 'ro' : 'r'}${node.reroll.values.join(',')}`
  if (node.min !== undefined) out += `min${node.min}`
  return out
}

/** Canonical text for a syntax tree; `parse(format(ast))` yields an equal tree. */
export function format(node: Node): string {
  switch (node.type) {
    case 'number':
      return String(node.value)
    case 'dice':
      return formatDice(node)
    case 'variable':
      return node.name
    case 'string':
      return `'${node.value}'`
    case 'call':
      return `${node.name}(${node.args.map(format).join(', ')})`
    case 'unary':
      return `-${wrap(node.operand, 3)}`
    case 'binary': {
      const precedence = PRECEDENCE[node.op]
      const left = wrap(node.left, precedence)
      // A right operand of equal precedence is always parenthesised, so the text re-parses to the
      // same tree: a - (b - c), a + (b + c).
      const right = wrapRight(node.right, precedence)
      return `${left} ${node.op} ${right}`
    }
  }
}

function wrap(node: Node, minPrecedence: number): string {
  const text = format(node)
  if (node.type === 'binary' && PRECEDENCE[node.op] < minPrecedence) return `(${text})`
  if (node.type === 'unary' && minPrecedence >= 3) return `(${text})`
  return text
}

function wrapRight(node: Node, precedence: number): string {
  const text = format(node)
  if (node.type === 'binary' && PRECEDENCE[node.op] <= precedence) return `(${text})`
  if (node.type === 'unary') return `(${text})`
  return text
}
