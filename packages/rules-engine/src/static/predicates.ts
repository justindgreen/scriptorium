import {
  ACTION_LEAF_NAMES,
  PACKET_LEAF_NAMES,
  type Ability,
  type Predicate,
} from '@scriptorium/content-schema'
import type { Diagnostic, SourceRef } from '../types.js'
import type { Lookup } from './resolver.js'

/** Facts about the character that static predicates may ask about (docs/RULES_ENGINE.md §4). */
export type PredicateFacts = {
  level: number
  classLevels: Map<string, number>
  speciesChain: Set<string>
  subclasses: Set<string>
  features: Set<string>
  conditions: Set<string>
  activeToggles: Set<string>
  armorCategory: 'none' | 'light' | 'medium' | 'heavy'
  shield: boolean
  equippedItems: Set<string>
  attunedItems: Set<string>
}

/** The item an effect belongs to, for `equipped(self)` / `attuned(self)`. */
export type SelfItem = { uid?: string; equipped: boolean; attuned: boolean }

export type PredicateEnv = {
  facts: PredicateFacts
  lookup: Lookup
  diagnostic(diagnostic: Diagnostic): void
}

type Leaf = Exclude<Predicate, { all: unknown } | { any: unknown } | { not: unknown }>

/**
 * Evaluates a static predicate. Static scope has no unknowns: every leaf is decidable from the
 * character alone. Action and packet leaves are refused by content validation; if one slips
 * through it evaluates to false with a SCOPE_VIOLATION diagnostic.
 */
export function evaluateStaticPredicate(
  predicate: Predicate,
  env: PredicateEnv,
  source: SourceRef,
  self?: SelfItem,
): boolean {
  if ('all' in predicate)
    return predicate.all.every((p) => evaluateStaticPredicate(p, env, source, self))
  if ('any' in predicate)
    return predicate.any.some((p) => evaluateStaticPredicate(p, env, source, self))
  if ('not' in predicate) return !evaluateStaticPredicate(predicate.not, env, source, self)
  return evaluateLeaf(predicate, env, source, self)
}

function evaluateLeaf(leaf: Leaf, env: PredicateEnv, source: SourceRef, self?: SelfItem): boolean {
  const { facts } = env
  switch (leaf.leaf) {
    case 'equipped':
      return leaf.item === 'self' ? Boolean(self?.equipped) : facts.equippedItems.has(leaf.item)
    case 'attuned':
      return leaf.item === 'self' ? Boolean(self?.attuned) : facts.attunedItems.has(leaf.item)
    case 'armor':
      if (leaf.category === 'any') return facts.armorCategory !== 'none'
      return facts.armorCategory === leaf.category
    case 'shield':
      return facts.shield === leaf.value
    case 'level':
      return facts.level >= leaf.gte
    case 'classLevel':
      return (facts.classLevels.get(leaf.class) ?? 0) >= leaf.gte
    case 'abilityScore':
      return env.lookup.number(`ability.${leaf.ability as Ability}.score`) >= leaf.gte
    case 'proficient': {
      const value = env.lookup.value(leaf.path)
      return typeof value === 'number' ? value > 0 : Boolean(value)
    }
    case 'hasCondition':
      return facts.conditions.has(leaf.condition)
    case 'toggle':
      return facts.activeToggles.has(leaf.id)
    case 'hasFeature':
      return facts.features.has(leaf.feature)
    case 'subclass':
      return facts.subclasses.has(leaf.subclass)
    case 'species':
      return facts.speciesChain.has(leaf.species)
    case 'wearingArmorCategory':
      return leaf.categories.some((c) =>
        c === 'shield' ? facts.shield : facts.armorCategory === c,
      )
    default: {
      const name = (leaf as { leaf: string }).leaf
      const scope = (ACTION_LEAF_NAMES as readonly string[]).includes(name)
        ? 'action'
        : (PACKET_LEAF_NAMES as readonly string[]).includes(name)
          ? 'packet'
          : 'unknown'
      env.diagnostic({
        code: 'SCOPE_VIOLATION',
        severity: 'error',
        message: `"${source.name}" uses the ${scope}-scoped predicate "${name}" in a static effect; it was treated as false`,
        sources: [source],
      })
      return false
    }
  }
}
