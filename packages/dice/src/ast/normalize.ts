import { LIMITS, type DiceNode, type Node } from './types.js'

/**
 * Rewrites `dice(count, faces)` calls with constant arguments into dice terms, so formulas whose
 * dice count is computed (`dice(ceil(classLevel('x') / 2), 6)` for Sneak Attack) become ordinary
 * `3d6` terms once their variables are substituted. A count of 0 or less becomes the number 0;
 * other arguments stay as they are and fail later evaluation with a clear message.
 */
export function normalizeDice(node: Node): Node {
  switch (node.type) {
    case 'call': {
      const args = node.args.map(normalizeDice)
      if (node.name === 'dice' && args.length === 2) {
        const [count, faces] = args
        if (count?.type === 'number' && faces?.type === 'number') {
          const n = Math.floor(count.value)
          const f = Math.floor(faces.value)
          if (n <= 0) return { type: 'number', value: 0 }
          if (n <= LIMITS.maxDiceCount && f >= 2 && f <= LIMITS.maxFaces) {
            const dice: DiceNode = { type: 'dice', count: n, faces: f }
            return dice
          }
        }
      }
      return { ...node, args }
    }
    case 'binary':
      return { ...node, left: normalizeDice(node.left), right: normalizeDice(node.right) }
    case 'unary':
      return { ...node, operand: normalizeDice(node.operand) }
    default:
      return node
  }
}

/** Evaluates arithmetic whose operands are all numbers; dice and names are left in place. */
export function foldConstants(node: Node): Node {
  switch (node.type) {
    case 'unary': {
      const operand = foldConstants(node.operand)
      return operand.type === 'number'
        ? { type: 'number', value: -operand.value }
        : { ...node, operand }
    }
    case 'binary': {
      const left = foldConstants(node.left)
      const right = foldConstants(node.right)
      if (left.type === 'number' && right.type === 'number') {
        switch (node.op) {
          case '+':
            return { type: 'number', value: left.value + right.value }
          case '-':
            return { type: 'number', value: left.value - right.value }
          case '*':
            return { type: 'number', value: left.value * right.value }
          case '/':
            if (right.value !== 0) return { type: 'number', value: left.value / right.value }
        }
      }
      return { ...node, left, right }
    }
    case 'call': {
      const args = node.args.map(foldConstants)
      const numbers = args.filter(
        (a): a is Extract<Node, { type: 'number' }> => a.type === 'number',
      )
      if (numbers.length === args.length && args.length > 0) {
        const values = numbers.map((n) => n.value)
        switch (node.name) {
          case 'floor':
            if (values.length === 1) return { type: 'number', value: Math.floor(values[0]!) }
            break
          case 'ceil':
            if (values.length === 1) return { type: 'number', value: Math.ceil(values[0]!) }
            break
          case 'abs':
            if (values.length === 1) return { type: 'number', value: Math.abs(values[0]!) }
            break
          case 'max':
            return { type: 'number', value: Math.max(...values) }
          case 'min':
            return { type: 'number', value: Math.min(...values) }
        }
      }
      return { ...node, args }
    }
    default:
      return node
  }
}
