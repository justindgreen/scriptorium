import type { Predicate } from '@scriptorium/content-schema'
import type { CombatState, SheetFacts, SourceRef, StatValue } from '../types.js'
import type { ActionSituation, AttackType, Question, TargetDescriptor } from './types.js'

export type WeaponFacts = {
  properties: string[]
  category: 'simple' | 'martial'
  twoHanded: boolean
  oneHanded: boolean
  monk: boolean
}

/** Facts available while planning one action; unknown facts are asked for. */
export type ActionPredicateEnv = {
  facts: SheetFacts
  stats: Record<string, StatValue>
  combat: CombatState
  attackType?: AttackType
  weapon?: WeaponFacts
  target?: TargetDescriptor
  situation: ActionSituation
  slotLevel?: number
  /** Known once advantage sources are settled; null while they are being computed. */
  hasAdvantage: boolean | null
  /** The item an effect belongs to, for `equipped(self)`. */
  self?: { equipped: boolean; attuned: boolean }
  /** Returns the answer (given, stored or default) and records the question. */
  ask(question: Omit<Question, 'assumed'>, fallback: unknown): unknown
  scopeViolation(source: SourceRef, leaf: string): void
}

type Leaf = Exclude<Predicate, { all: unknown } | { any: unknown } | { not: unknown }>

/**
 * Evaluates an action-scope predicate. Unknown facts are turned into questions with an assumed
 * answer, so the result is always decided (docs/RULES_ENGINE.md §6).
 */
export function evaluateActionPredicate(
  predicate: Predicate,
  env: ActionPredicateEnv,
  source: SourceRef,
  affects: string[],
): boolean {
  if ('all' in predicate)
    return predicate.all.every((p) => evaluateActionPredicate(p, env, source, affects))
  if ('any' in predicate)
    return predicate.any.some((p) => evaluateActionPredicate(p, env, source, affects))
  if ('not' in predicate) return !evaluateActionPredicate(predicate.not, env, source, affects)
  return leaf(predicate, env, source, affects)
}

function leaf(l: Leaf, env: ActionPredicateEnv, source: SourceRef, affects: string[]): boolean {
  const { facts, target, situation } = env
  const number = (path: string) => {
    const v = env.stats[path]?.value
    return typeof v === 'number' ? v : 0
  }
  switch (l.leaf) {
    // static leaves
    case 'equipped':
      return l.item === 'self' ? Boolean(env.self?.equipped) : facts.equippedItems.includes(l.item)
    case 'attuned':
      return l.item === 'self' ? Boolean(env.self?.attuned) : facts.attunedItems.includes(l.item)
    case 'armor':
      return l.category === 'any'
        ? facts.armorCategory !== 'none'
        : facts.armorCategory === l.category
    case 'shield':
      return facts.shield === l.value
    case 'level':
      return facts.level >= l.gte
    case 'classLevel':
      return (facts.classLevels[l.class] ?? 0) >= l.gte
    case 'abilityScore':
      return number(`ability.${l.ability}.score`) >= l.gte
    case 'proficient': {
      const v = env.stats[l.path]?.value
      return typeof v === 'number' ? v > 0 : Boolean(v)
    }
    case 'hasCondition':
      return facts.conditions.includes(l.condition)
    case 'toggle':
      return facts.activeToggles.includes(l.id)
    case 'hasFeature':
      return facts.features.includes(l.feature)
    case 'subclass':
      return facts.subclasses.includes(l.subclass)
    case 'species':
      return facts.speciesChain.includes(l.species)
    case 'wearingArmorCategory':
      return l.categories.some((c) => (c === 'shield' ? facts.shield : facts.armorCategory === c))
    // action leaves
    case 'ctx.weaponProperty':
      return Boolean(env.weapon?.properties.includes(l.property))
    case 'ctx.weaponCategory':
      return env.weapon?.category === l.category
    case 'ctx.attackType':
      return env.attackType === l.type
    case 'ctx.isMonkWeapon':
      return Boolean(env.weapon?.monk)
    case 'ctx.twoHanded':
      return Boolean(env.weapon?.twoHanded)
    case 'ctx.wieldingOneHanded':
      return Boolean(env.weapon?.oneHanded)
    case 'ctx.slotLevel':
      return (env.slotLevel ?? 0) >= l.gte
    case 'ctx.oncePerTurnAvailable':
      return env.combat.oncePerTurn[l.key] !== env.combat.turn.turnId
    case 'ctx.hasAdvantage':
      if (env.hasAdvantage !== null) return env.hasAdvantage
      return Boolean(
        env.ask(
          {
            id: 'hasAdvantage',
            text: 'Do you have advantage on this attack?',
            kind: 'boolean',
            affects,
          },
          false,
        ),
      )
    case 'ctx.allyAdjacent':
      if (situation.allyAdjacentToTarget !== undefined) return situation.allyAdjacentToTarget
      return Boolean(
        env.ask(
          {
            id: 'allyAdjacent',
            text: 'Is an ally of yours within 5 feet of the target?',
            kind: 'boolean',
            affects,
          },
          false,
        ),
      )
    case 'ctx.firstAttackThisTurn':
      if (situation.firstAttackThisTurn !== undefined) return situation.firstAttackThisTurn
      return Boolean(
        env.ask(
          {
            id: 'firstAttackThisTurn',
            text: 'Is this your first attack this turn?',
            kind: 'boolean',
            affects,
          },
          true,
        ),
      )
    case 'ctx.targetType': {
      const type =
        target?.creatureType ??
        env.ask(
          {
            id: 'target.creatureType',
            text: 'What kind of creature is the target?',
            kind: 'creatureType',
            affects,
          },
          undefined,
        )
      return typeof type === 'string' && (l.types as string[]).includes(type)
    }
    case 'ctx.targetSize': {
      const size =
        target?.size ??
        env.ask(
          { id: 'target.size', text: 'What size is the target?', kind: 'size', affects },
          undefined,
        )
      return typeof size === 'string' && (l.sizes as string[]).includes(size)
    }
    case 'ctx.targetHasCondition': {
      if (target?.conditions) return target.conditions.includes(l.condition)
      return Boolean(
        env.ask(
          {
            id: `target.condition.${l.condition}`,
            text: `Is the target ${l.condition}?`,
            kind: 'condition',
            affects,
          },
          false,
        ),
      )
    }
    default:
      env.scopeViolation(source, (l as { leaf: string }).leaf)
      return false
  }
}
