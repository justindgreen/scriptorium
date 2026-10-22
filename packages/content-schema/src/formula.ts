import { z } from 'zod'

/**
 * Structural validation of formula strings. The grammar (docs/RULES_ENGINE.md §4) is parsed for
 * real by `@scriptorium/dice/ast`; here we only make sure a formula uses allowed characters,
 * functions and variables for its scope, so bad content is refused at save time.
 *
 * Grammar sketch: integers, dice terms (`2d6`, `4d6kh3`), `+ - * /`, parentheses, functions
 * `floor ceil max min table classLevel`, quoted names as function arguments
 * (`table('sneak-attack', classLevel('srd-5.1:class:rogue'))`), and scope variables.
 */
export type FormulaScope = 'static' | 'action'

const FUNCTIONS = new Set(['floor', 'ceil', 'max', 'min', 'abs', 'table', 'classLevel', 'dice'])

const STATIC_VARIABLES = new Set([
  'STR',
  'DEX',
  'CON',
  'INT',
  'WIS',
  'CHA',
  'STRscore',
  'DEXscore',
  'CONscore',
  'INTscore',
  'WISscore',
  'CHAscore',
  'PB',
  'level',
  'castingMod',
])

const ACTION_VARIABLES = new Set([...STATIC_VARIABLES, 'slotLevel'])

const TOKEN =
  /\s*(?:(\d+d\d+(?:[kd][hl]\d+)?)|(\d+(?:\.\d+)?)|('[^']{1,120}')|([A-Za-z_][A-Za-z0-9_]*)|([-+*/(),]))/y

export type FormulaIssue = { message: string }

/** Returns the first problem with a formula, or null when it is acceptable for the scope. */
export function checkFormula(input: string, scope: FormulaScope): FormulaIssue | null {
  const text = input.trim()
  if (text.length === 0) return { message: 'formula is empty' }
  if (text.length > 200) return { message: 'formula is too long' }
  const variables = scope === 'action' ? ACTION_VARIABLES : STATIC_VARIABLES
  let index = 0
  let depth = 0
  while (index < text.length) {
    TOKEN.lastIndex = index
    const match = TOKEN.exec(text)
    if (!match || match.index !== index) {
      return { message: `unexpected character at position ${index + 1} in "${input}"` }
    }
    const [whole, dice, number, quoted, identifier, punct] = match
    index += whole.length
    if (dice || number || quoted) continue
    if (identifier) {
      if (FUNCTIONS.has(identifier)) continue
      if (!variables.has(identifier)) {
        return { message: `unknown variable "${identifier}" for ${scope} formula` }
      }
      continue
    }
    if (punct === '(') depth += 1
    if (punct === ')') {
      depth -= 1
      if (depth < 0) return { message: 'unbalanced parentheses' }
    }
  }
  if (depth !== 0) return { message: 'unbalanced parentheses' }
  return null
}

export function formulaSchema(scope: FormulaScope) {
  return z.string().superRefine((value, ctx) => {
    const issue = checkFormula(value, scope)
    if (issue) ctx.addIssue({ code: 'custom', message: issue.message })
  })
}

/** A plain number or a formula string. */
export function numberOrFormulaSchema(scope: FormulaScope) {
  return z.union([z.number().int().min(-1000).max(1000), formulaSchema(scope)])
}

export type Formula = string
