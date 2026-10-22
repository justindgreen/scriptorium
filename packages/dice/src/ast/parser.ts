import { LIMITS, type DiceNode, type Node, type ParseResult } from './types.js'

type Token =
  | { type: 'number'; value: number; pos: number }
  | { type: 'dice'; node: DiceNode; pos: number }
  | { type: 'ident'; value: string; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/'; pos: number }
  | { type: 'lparen' | 'rparen' | 'comma'; pos: number }
  | { type: 'end'; pos: number }

class SyntaxError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message)
  }
}

const DICE = /^(\d*)[dD](\d+|%)((?:(?:kh|kl|dh|dl|ro|r|min)\d+(?:,\d+)*)*)/
const MODIFIER = /(kh|kl|dh|dl|ro|r|min)(\d+(?:,\d+)*)/g

function parseDice(raw: string, pos: number): DiceNode {
  const match = DICE.exec(raw)
  if (!match) throw new SyntaxError('invalid dice notation', pos)
  const count = match[1] === '' ? 1 : Number(match[1])
  const faces = match[2] === '%' ? 100 : Number(match[2])
  if (count < 1 || count > LIMITS.maxDiceCount) {
    throw new SyntaxError(`dice count must be between 1 and ${LIMITS.maxDiceCount}`, pos)
  }
  if (faces < 2 || faces > LIMITS.maxFaces) {
    throw new SyntaxError(`dice must have between 2 and ${LIMITS.maxFaces} faces`, pos)
  }
  const node: DiceNode = { type: 'dice', count, faces }
  for (const m of (match[3] ?? '').matchAll(MODIFIER)) {
    const kind = m[1]!
    const numbers = m[2]!.split(',').map(Number)
    const n = numbers[0]!
    switch (kind) {
      case 'kh':
      case 'kl':
        if (node.keep || node.drop)
          throw new SyntaxError('only one keep or drop modifier is allowed', pos)
        if (n < 1 || n > count)
          throw new SyntaxError('keep count must be between 1 and the dice count', pos)
        node.keep = { mode: kind === 'kh' ? 'highest' : 'lowest', count: n }
        break
      case 'dh':
      case 'dl':
        if (node.keep || node.drop)
          throw new SyntaxError('only one keep or drop modifier is allowed', pos)
        if (n < 1 || n >= count)
          throw new SyntaxError('drop count must leave at least one die', pos)
        node.drop = { mode: kind === 'dh' ? 'highest' : 'lowest', count: n }
        break
      case 'r':
      case 'ro':
        if (node.reroll) throw new SyntaxError('only one reroll modifier is allowed', pos)
        if (numbers.some((v) => v < 1 || v > faces))
          throw new SyntaxError('reroll values must be faces of the die', pos)
        if (kind === 'r' && new Set(numbers).size >= faces)
          throw new SyntaxError('rerolling every face never ends', pos)
        node.reroll = { values: [...new Set(numbers)].sort((a, b) => a - b), once: kind === 'ro' }
        break
      case 'min':
        if (n < 1 || n > faces) throw new SyntaxError('min must be a face of the die', pos)
        node.min = n
        break
    }
  }
  return node
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]!
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    const rest = input.slice(i)
    const dice = DICE.exec(rest)
    if (dice && (i === 0 || !/[A-Za-z_]/.test(input[i - 1]!))) {
      tokens.push({ type: 'dice', node: parseDice(dice[0], i), pos: i })
      i += dice[0].length
      continue
    }
    const number = /^\d+(?:\.\d+)?/.exec(rest)
    if (number) {
      tokens.push({ type: 'number', value: Number(number[0]), pos: i })
      i += number[0].length
      continue
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)
    if (ident) {
      tokens.push({ type: 'ident', value: ident[0], pos: i })
      i += ident[0].length
      continue
    }
    if (ch === "'") {
      const end = input.indexOf("'", i + 1)
      if (end < 0) throw new SyntaxError('unterminated string', i)
      tokens.push({ type: 'string', value: input.slice(i + 1, end), pos: i })
      i = end + 1
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch, pos: i })
    } else if (ch === '(') {
      tokens.push({ type: 'lparen', pos: i })
    } else if (ch === ')') {
      tokens.push({ type: 'rparen', pos: i })
    } else if (ch === ',') {
      tokens.push({ type: 'comma', pos: i })
    } else {
      throw new SyntaxError(`unexpected character "${ch}"`, i)
    }
    i += 1
  }
  tokens.push({ type: 'end', pos: input.length })
  return tokens
}

class Parser {
  private index = 0
  private depth = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): Node {
    const node = this.expression()
    const token = this.peek()
    if (token.type !== 'end') throw new SyntaxError('unexpected input after expression', token.pos)
    return node
  }

  private peek(): Token {
    return this.tokens[this.index]!
  }

  private next(): Token {
    return this.tokens[this.index++]!
  }

  private expression(): Node {
    let left = this.term()
    for (;;) {
      const token = this.peek()
      if (token.type === 'op' && (token.value === '+' || token.value === '-')) {
        this.next()
        left = { type: 'binary', op: token.value, left, right: this.term() }
      } else {
        return left
      }
    }
  }

  private term(): Node {
    let left = this.unary()
    for (;;) {
      const token = this.peek()
      if (token.type === 'op' && (token.value === '*' || token.value === '/')) {
        this.next()
        left = { type: 'binary', op: token.value, left, right: this.unary() }
      } else {
        return left
      }
    }
  }

  private unary(): Node {
    const token = this.peek()
    if (token.type === 'op' && token.value === '-') {
      this.next()
      return { type: 'unary', op: '-', operand: this.unary() }
    }
    if (token.type === 'op' && token.value === '+') {
      this.next()
      return this.unary()
    }
    return this.primary()
  }

  private primary(): Node {
    const token = this.next()
    switch (token.type) {
      case 'number':
        return { type: 'number', value: token.value }
      case 'dice':
        return token.node
      case 'string':
        throw new SyntaxError('a quoted name is only valid as a function argument', token.pos)
      case 'ident': {
        if (this.peek().type === 'lparen') {
          this.next()
          this.enter(token.pos)
          const args: Node[] = []
          if (this.peek().type !== 'rparen') {
            for (;;) {
              args.push(this.argument())
              if (this.peek().type === 'comma') {
                this.next()
                continue
              }
              break
            }
          }
          const close = this.next()
          if (close.type !== 'rparen')
            throw new SyntaxError('expected ")" after function arguments', close.pos)
          this.depth -= 1
          return { type: 'call', name: token.value, args }
        }
        return { type: 'variable', name: token.value }
      }
      case 'lparen': {
        this.enter(token.pos)
        const inner = this.expression()
        const close = this.next()
        if (close.type !== 'rparen') throw new SyntaxError('expected ")"', close.pos)
        this.depth -= 1
        return inner
      }
      case 'end':
        throw new SyntaxError('unexpected end of expression', token.pos)
      default:
        throw new SyntaxError('unexpected token', token.pos)
    }
  }

  private argument(): Node {
    const token = this.peek()
    if (token.type === 'string') {
      this.next()
      return { type: 'string', value: token.value }
    }
    return this.expression()
  }

  private enter(pos: number) {
    this.depth += 1
    if (this.depth > LIMITS.maxDepth) throw new SyntaxError('expression is nested too deeply', pos)
  }
}

/** Parses a dice expression or formula. Never throws. */
export function parse(input: string): ParseResult {
  if (typeof input !== 'string')
    return { ok: false, error: { message: 'expression must be a string', position: 0 } }
  const text = input.trim()
  if (text.length === 0)
    return { ok: false, error: { message: 'expression is empty', position: 0 } }
  if (text.length > LIMITS.maxLength) {
    return {
      ok: false,
      error: {
        message: `expression is longer than ${LIMITS.maxLength} characters`,
        position: LIMITS.maxLength,
      },
    }
  }
  try {
    return { ok: true, ast: new Parser(tokenize(text)).parse() }
  } catch (error) {
    if (error instanceof SyntaxError)
      return { ok: false, error: { message: error.message, position: error.position } }
    throw error
  }
}

/** Parses or throws an Error with the position in the message. */
export function parseOrThrow(input: string): Node {
  const result = parse(input)
  if (result.ok) return result.ast
  throw new Error(`${result.error.message} (at ${result.error.position + 1})`)
}
