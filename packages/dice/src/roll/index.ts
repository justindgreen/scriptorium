/**
 * @scriptorium/dice/roll
 *
 * Evaluates dice expressions with an injectable random number generator.
 * Only the server's explicit roll step may use this entry point. The rules engine never imports it.
 * The evaluator lands in milestone M2.1.
 */
import { packageName as astPackageName } from '../ast/index.js'

export const packageName = '@scriptorium/dice/roll' as const

/** A source of uniformly distributed numbers in [0, 1). */
export type Rng = () => number

export const dependsOn = astPackageName
