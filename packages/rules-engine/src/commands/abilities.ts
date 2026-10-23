import type { Ability } from '@scriptorium/content-schema'
import type { CharacterDefinition, RulesetProfile } from '../types.js'

export const ABILITY_KEYS: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']

/**
 * Why a set of base scores is illegal for the chosen method (2014 builder rules), or `null` when
 * it is legal. Shared by the `setAbilities` command and by character creation so the server never
 * accepts scores the engine would refuse. `rolled` and `manual` accept any score from 1 to 30;
 * whether rolled scores really came from a roll is the server's responsibility (the engine never
 * rolls).
 */
export function validateAbilityScores(
  method: CharacterDefinition['abilityMethod'],
  abilities: Record<Ability, number>,
  ruleset?: RulesetProfile,
): string | null {
  for (const ability of ABILITY_KEYS) {
    const v = abilities[ability]
    if (!Number.isInteger(v) || v < 1 || v > 30) return `${ability} must be 1 to 30`
  }
  if (method === 'standard') {
    const array = ruleset?.config.standardArray ?? [15, 14, 13, 12, 10, 8]
    const sorted = ABILITY_KEYS.map((a) => abilities[a]).sort((a, b) => b - a)
    if (JSON.stringify(sorted) !== JSON.stringify([...array].sort((a, b) => b - a)))
      return 'the standard array must be used exactly once'
  }
  if (method === 'point_buy' && ruleset) {
    const pb = ruleset.config.pointBuy
    let spent = 0
    for (const ability of ABILITY_KEYS) {
      const v = abilities[ability]
      if (v < pb.min || v > pb.max) return `point buy scores are ${pb.min} to ${pb.max}`
      spent += pb.costs[String(v)] ?? 0
    }
    if (spent > pb.budget) return `point buy spends ${spent} of ${pb.budget} points`
  }
  return null
}
