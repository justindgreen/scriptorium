import type { DieRoller } from './rng.js'

export type RollMode = 'normal' | 'advantage' | 'disadvantage'

export type D20Roll = {
  mode: RollMode
  /** Every d20 rolled (two under advantage or disadvantage). */
  dice: number[]
  /** The die that counts. */
  natural: number
  modifier: number
  total: number
  /** Natural roll at or above the critical threshold (attacks only; callers decide relevance). */
  isCritical: boolean
  isNaturalOne: boolean
}

/**
 * A d20 test (attack roll, check or save): advantage and disadvantage roll two dice and keep the
 * highest or lowest. `critRange` is the lowest natural roll that counts as a critical hit (20, or
 * 19 with Improved Critical).
 */
export function rollD20(options: {
  dice: DieRoller
  modifier?: number
  mode?: RollMode
  critRange?: number
}): D20Roll {
  const mode = options.mode ?? 'normal'
  const modifier = options.modifier ?? 0
  const critRange = options.critRange ?? 20
  const dice = [options.dice(20)]
  if (mode !== 'normal') dice.push(options.dice(20))
  const natural =
    mode === 'advantage'
      ? Math.max(...dice)
      : mode === 'disadvantage'
        ? Math.min(...dice)
        : dice[0]!
  return {
    mode,
    dice,
    natural,
    modifier,
    total: natural + modifier,
    isCritical: natural >= critRange,
    isNaturalOne: natural === 1,
  }
}

/** Combines advantage and disadvantage sources the 5e way: having any of both cancels to a normal roll. */
export function resolveMode(advantageSources: number, disadvantageSources: number): RollMode {
  if (advantageSources > 0 && disadvantageSources > 0) return 'normal'
  if (advantageSources > 0) return 'advantage'
  if (disadvantageSources > 0) return 'disadvantage'
  return 'normal'
}
