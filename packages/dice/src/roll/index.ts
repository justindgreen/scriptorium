/**
 * @scriptorium/dice/roll
 *
 * Evaluates dice expressions with an injectable random number generator. Only the server's explicit
 * roll step (and tests) may use this entry point; the rules engine never imports it.
 */
import { packageName as astPackageName } from '../ast/index.js'

export const packageName = '@scriptorium/dice/roll' as const
export const dependsOn = astPackageName

export type { DieRoller, Rng } from './rng.js'
export { createCryptoRng, createSeededRng, dieRoller, scriptedDice } from './rng.js'
export type { DieResult, RollContext, RollResult, RollTerm } from './evaluate.js'
export { describe, roll, rollDice, RollError } from './evaluate.js'
export type { D20Roll, RollMode } from './d20.js'
export { resolveMode, rollD20 } from './d20.js'
