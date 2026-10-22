import { parse, format, foldConstants, normalizeDice, type Node } from '@scriptorium/dice/ast'
import type { Ability } from '@scriptorium/content-schema'

/** Raised when a formula cannot be evaluated to a number in the current scope. */
export class FormulaError extends Error {
  constructor(
    message: string,
    public readonly code: 'UNKNOWN_VARIABLE' | 'FORMULA_ERROR',
  ) {
    super(message)
    this.name = 'FormulaError'
  }
}

/** What the static engine can answer for a formula: variables, class levels and class tables. */
export type FormulaScope = {
  abilityMod(ability: Ability): number
  abilityScore(ability: Ability): number
  proficiencyBonus(): number
  level(): number
  classLevel(classUid: string): number
  castingMod(): number
  slotLevel(): number
  table(name: string, level: number): number
}

const ABILITY_NAMES: Record<string, Ability> = {
  STR: 'str',
  DEX: 'dex',
  CON: 'con',
  INT: 'int',
  WIS: 'wis',
  CHA: 'cha',
}

const cache = new Map<string, Node>()

/** Parses with a cache; throws FormulaError on syntax errors. */
export function parseFormula(text: string): Node {
  const cached = cache.get(text)
  if (cached) return cached
  const result = parse(text)
  if (!result.ok)
    throw new FormulaError(`invalid formula "${text}": ${result.error.message}`, 'FORMULA_ERROR')
  cache.set(text, result.ast)
  return result.ast
}

/**
 * Evaluates a static formula to a number. Dice are not allowed: static values are never rolled
 * (docs/RULES_ENGINE.md §9); a formula with dice belongs on an action template instead.
 */
export function evaluateNumeric(formula: string | number | Node, scope: FormulaScope): number {
  if (typeof formula === 'number') return formula
  const ast = typeof formula === 'string' ? parseFormula(formula) : formula
  return evaluateNode(ast, scope)
}

function evaluateNode(node: Node, scope: FormulaScope): number {
  switch (node.type) {
    case 'number':
      return node.value
    case 'dice':
      throw new FormulaError('dice are not allowed in a static formula', 'FORMULA_ERROR')
    case 'string':
      throw new FormulaError('a quoted name is only valid as a function argument', 'FORMULA_ERROR')
    case 'variable':
      return resolveVariable(node.name, scope)
    case 'unary':
      return -evaluateNode(node.operand, scope)
    case 'binary': {
      const left = evaluateNode(node.left, scope)
      const right = evaluateNode(node.right, scope)
      switch (node.op) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          if (right === 0) throw new FormulaError('division by zero', 'FORMULA_ERROR')
          return left / right
      }
      throw new FormulaError('unknown operator', 'FORMULA_ERROR')
    }
    case 'call':
      return evaluateCall(node.name, node.args, scope)
  }
}

function resolveVariable(name: string, scope: FormulaScope): number {
  const ability = ABILITY_NAMES[name]
  if (ability) return scope.abilityMod(ability)
  if (name.endsWith('score')) {
    const scored = ABILITY_NAMES[name.slice(0, -5)]
    if (scored) return scope.abilityScore(scored)
  }
  switch (name) {
    case 'PB':
      return scope.proficiencyBonus()
    case 'level':
      return scope.level()
    case 'castingMod':
    case 'MOD':
      return scope.castingMod()
    case 'slotLevel':
      return scope.slotLevel()
    default:
      throw new FormulaError(`unknown variable "${name}"`, 'UNKNOWN_VARIABLE')
  }
}

function evaluateCall(name: string, args: Node[], scope: FormulaScope): number {
  const numeric = (index: number): number => {
    const arg = args[index]
    if (!arg) throw new FormulaError(`${name}() is missing argument ${index + 1}`, 'FORMULA_ERROR')
    return evaluateNode(arg, scope)
  }
  const text = (index: number): string => {
    const arg = args[index]
    if (!arg || arg.type !== 'string') {
      throw new FormulaError(
        `${name}() expects a quoted name as argument ${index + 1}`,
        'FORMULA_ERROR',
      )
    }
    return arg.value
  }
  switch (name) {
    case 'floor':
      return Math.floor(numeric(0))
    case 'ceil':
      return Math.ceil(numeric(0))
    case 'abs':
      return Math.abs(numeric(0))
    case 'max':
      return Math.max(...args.map((_, i) => numeric(i)))
    case 'min':
      return Math.min(...args.map((_, i) => numeric(i)))
    case 'classLevel':
      return scope.classLevel(text(0))
    case 'table':
      return scope.table(text(0), args.length > 1 ? numeric(1) : scope.level())
    default:
      throw new FormulaError(`unknown function "${name}"`, 'UNKNOWN_VARIABLE')
  }
}

/**
 * Replaces variables and class-table calls with their current values and returns the formula
 * text with dice kept symbolic: `1d10 + classLevel('x')` becomes `1d10 + 5`. Used for display.
 */
export function substituteVariables(formula: string, scope: FormulaScope): string {
  const ast = parseFormula(formula)
  return format(normalizeDice(foldConstants(substituteNode(ast, scope))))
}

function substituteNode(node: Node, scope: FormulaScope): Node {
  switch (node.type) {
    case 'variable':
      return { type: 'number', value: resolveVariable(node.name, scope) }
    case 'call':
      if (node.name === 'classLevel' || node.name === 'table') {
        return { type: 'number', value: evaluateCall(node.name, node.args, scope) }
      }
      return { ...node, args: node.args.map((arg) => substituteNode(arg, scope)) }
    case 'binary':
      return {
        ...node,
        left: substituteNode(node.left, scope),
        right: substituteNode(node.right, scope),
      }
    case 'unary':
      return { ...node, operand: substituteNode(node.operand, scope) }
    default:
      return node
  }
}
