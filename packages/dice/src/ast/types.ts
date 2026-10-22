/** Dice and formula syntax tree (docs/RULES_ENGINE.md §4, "Formula grammar"). */

export type KeepDrop = { mode: 'highest' | 'lowest'; count: number }

export type DiceNode = {
  type: 'dice'
  count: number
  faces: number
  /** Keep the highest/lowest N dice (`kh3`, `kl1`). Mutually exclusive with `drop`. */
  keep?: KeepDrop
  /** Drop the highest/lowest N dice (`dh1`, `dl1`). */
  drop?: KeepDrop
  /** Reroll dice showing any of these values; `once` rerolls at most once per die (`ro1,2`). */
  reroll?: { values: number[]; once: boolean }
  /** Treat any die below this value as this value (`min2`). */
  min?: number
}

export type Node =
  | { type: 'number'; value: number }
  | DiceNode
  | { type: 'variable'; name: string }
  /** Only valid as a function argument, e.g. table('sneak-attack', ...). */
  | { type: 'string'; value: string }
  | { type: 'call'; name: string; args: Node[] }
  | { type: 'binary'; op: '+' | '-' | '*' | '/'; left: Node; right: Node }
  | { type: 'unary'; op: '-'; operand: Node }

export type ParseError = { message: string; position: number }

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: ParseError }

export const LIMITS = {
  maxLength: 200,
  maxDiceCount: 100,
  maxFaces: 1000,
  maxDepth: 24,
  maxRerolls: 100,
} as const

export const BUILTIN_FUNCTIONS = ['floor', 'ceil', 'max', 'min', 'abs'] as const
