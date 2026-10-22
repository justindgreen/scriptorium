/**
 * @scriptorium/rules-engine
 *
 * Pure TypeScript. No I/O, no clock, no randomness. Runs on the server (source of truth) and in the
 * browser (previews). May import only @scriptorium/content-schema and @scriptorium/dice/ast;
 * eslint.config.js enforces this. Static sheet computation is here (M2.2); action resolution and
 * spellcasting follow in M2.3, commands in M2.5.
 */
import { packageName as diceAst } from '@scriptorium/dice/ast'
import { CONTENT_SCHEMA_VERSION } from '@scriptorium/content-schema'
import type { CharacterAggregate, CharacterState, ComputedSheet, StatScalar } from './types.js'

export { ENGINE_VERSION } from './version.js'

/** The content schema version this engine build understands. */
export const SUPPORTED_CONTENT_SCHEMA_VERSION = CONTENT_SCHEMA_VERSION

export const allowedDependencies = [diceAst, '@scriptorium/content-schema'] as const

export type * from './types.js'
export { computeSheet } from './static/sheet.js'
export { createSnapshot, createRulesetProfile, speciesChain, entryOfKind } from './snapshot.js'
export { StatResolver, CycleError } from './static/resolver.js'
export type { Contribution, ContributionValue, Lookup, ResolverEnv } from './static/resolver.js'
export { evaluateNumeric, substituteVariables, FormulaError } from './static/formula.js'
export type { FormulaScope } from './static/formula.js'
export { evaluateStaticPredicate } from './static/predicates.js'
export type { PredicateFacts, PredicateEnv } from './static/predicates.js'
export { applySelection } from './static/choices.js'
export { REGISTERED_HOOKS, expandHook } from './hooks/index.js'
export type * from './actions/types.js'
export { planAction, scopeFromSheet } from './actions/plan.js'
export { applyRolls, applyPackets, defensesFromSheet } from './actions/apply.js'
export { monsterDefenses, parseDefenseText, evaluatePacketPredicate } from './actions/defenses.js'
export { evaluateActionPredicate } from './actions/predicates.js'
export type { ActionPredicateEnv, WeaponFacts } from './actions/predicates.js'

/** Reads one stat's value from a sheet; undefined when the path was never computed. */
export function statValue(sheet: ComputedSheet, path: string): StatScalar | undefined {
  return sheet.stats[path]?.value
}

/** A fresh runtime state for a new character; the builder and commands mutate it from here. */
export function defaultCharacterState(): CharacterState {
  return {
    hpCurrent: 0,
    hpTemp: 0,
    deathSaves: { successes: 0, failures: 0 },
    hitDiceSpent: {},
    spellSlotsUsed: {},
    pactSlotsUsed: 0,
    resources: {},
    conditions: [],
    exhaustion: 0,
    concentration: null,
    inspiration: false,
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    activeEffects: [],
    toggles: {},
    combat: {
      turn: { encounterId: null, round: null, turnId: 'local:0', ownTurn: true },
      oncePerTurn: {},
      reaction: { usedOnTurnId: null },
      bonusAction: { usedOnTurnId: null },
      actions: { budget: 1, usedOnTurnId: null },
    },
    assumptions: {},
  }
}

/** Minimal aggregate for tests and previews; everything not given is empty. */
export function createAggregate(
  partial: Partial<Omit<CharacterAggregate, 'definition' | 'state'>> & {
    definition?: Partial<CharacterAggregate['definition']>
    state?: Partial<CharacterState>
  },
): CharacterAggregate {
  return {
    id: partial.id ?? 'character',
    rulesetId: partial.rulesetId ?? 'srd5.1-2014',
    name: partial.name ?? 'Character',
    revision: partial.revision ?? 0,
    inventory: partial.inventory ?? [],
    definition: {
      abilityMethod: 'manual',
      baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      classes: [],
      choices: {},
      spells: [],
      overrides: [],
      hpMode: 'fixed',
      xp: 0,
      ...partial.definition,
    },
    state: { ...defaultCharacterState(), ...partial.state },
  }
}
