/**
 * @scriptorium/dice/ast
 *
 * Pure dice-expression syntax: parser, validator, formatter, analysis and expected values.
 * This entry point has no dependencies and no randomness; the rules engine may import it.
 */
export const packageName = '@scriptorium/dice/ast' as const

export type { DiceNode, KeepDrop, Node, ParseError, ParseResult } from './types.js'
export { BUILTIN_FUNCTIONS, LIMITS } from './types.js'
export { parse, parseOrThrow } from './parser.js'
export { format, formatDice } from './format.js'
export {
  collectDice,
  collectFunctions,
  collectVariables,
  hasDice,
  keptCount,
  multiplyDice,
  range,
} from './analyze.js'
export { expectedDice, expectedValue, singleDieDistribution } from './expected.js'
export { foldConstants, normalizeDice } from './normalize.js'
export type { ExpectedContext } from './expected.js'

import { parse } from './parser.js'
import { collectFunctions, collectVariables } from './analyze.js'
import { BUILTIN_FUNCTIONS } from './types.js'

export type ValidationIssue = {
  code: 'SYNTAX' | 'UNKNOWN_VARIABLE' | 'UNKNOWN_FUNCTION'
  message: string
  position?: number
}

/**
 * Structural validation for content authoring: parses the expression and checks that every
 * variable and function is allowed. `allowedFunctions` is in addition to the arithmetic built-ins.
 */
export function validate(
  input: string,
  options: { allowedVariables: readonly string[]; allowedFunctions?: readonly string[] },
): { ok: true } | { ok: false; issues: ValidationIssue[] } {
  const parsed = parse(input)
  if (!parsed.ok) {
    return {
      ok: false,
      issues: [{ code: 'SYNTAX', message: parsed.error.message, position: parsed.error.position }],
    }
  }
  const issues: ValidationIssue[] = []
  for (const name of collectVariables(parsed.ast)) {
    if (!options.allowedVariables.includes(name))
      issues.push({ code: 'UNKNOWN_VARIABLE', message: `unknown variable "${name}"` })
  }
  const functions = [...BUILTIN_FUNCTIONS, ...(options.allowedFunctions ?? [])]
  for (const name of collectFunctions(parsed.ast)) {
    if (!functions.includes(name))
      issues.push({ code: 'UNKNOWN_FUNCTION', message: `unknown function "${name}"` })
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}
