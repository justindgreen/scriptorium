import { z } from 'zod'
import { formulaSchema, numberOrFormulaSchema } from './formula.js'
import {
  abilitySchema,
  damageTypeSchema,
  markdownSchema,
  senseSchema,
  sizeSchema,
  slugSchema,
  speedModeSchema,
  uidSchema,
  weaponPropertySchema,
} from './ids.js'
import {
  actionPredicateSchema,
  packetPredicateSchema,
  staticPredicateSchema,
} from './predicates.js'
import { rollKeySchema, statPathSchema } from './statPaths.js'

/**
 * Registered engine hooks (docs/RULES_ENGINE.md §10). Content may reference only these ids; the
 * implementations live in @scriptorium/rules-engine.
 */
export const HOOK_IDS = ['sorcerer.fontOfMagic', 'scalingDieTable', 'unarmoredMovement'] as const
export const hookIdSchema = z.enum(HOOK_IDS)

const RECHARGE = ['shortRest', 'longRest', 'dawn', 'dusk', 'turn', 'none'] as const
export const rechargeSchema = z.enum(RECHARGE)

/** Fields every effect may carry. `condition` on a static effect must be a static predicate. */
const base = {
  /** Optional stable id so other content (or tests) can reference this effect. */
  id: slugSchema.optional(),
  /** Author-facing note shown in breakdowns. */
  note: z.string().max(300).optional(),
}

const staticBase = { ...base, condition: staticPredicateSchema.optional() }
const stackable = { stackKey: slugSchema.optional() }
const prioritised = { priority: z.number().int().min(-100).max(100).optional() }

const sf = formulaSchema('static')
const snf = numberOrFormulaSchema('static')
const anf = numberOrFormulaSchema('action')

export const resourceDefinitionSchema = z.strictObject({
  id: slugSchema,
  name: z.string().min(1).max(80),
  max: snf,
  recharge: rechargeSchema,
  /** Amount restored on recharge; defaults to all. */
  rechargeAmount: snf.optional(),
  /** For resources tracked as dice (e.g. Bardic Inspiration d6). */
  displayDie: z.enum(['d4', 'd6', 'd8', 'd10', 'd12']).optional(),
})

const actionCostSchema = z.union([
  z.strictObject({ resource: slugSchema, amount: z.number().int().min(1).default(1) }),
  z.strictObject({
    slotLevel: z.number().int().min(1).max(9),
    orHigher: z.boolean().default(true),
  }),
  z.strictObject({ charges: z.number().int().min(1).default(1) }),
])

const damageLineSchema = z.strictObject({
  formula: formulaSchema('action'),
  damageType: damageTypeSchema,
})

// --------------------------------------------------------------------------- static effects

export const staticEffectSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('abilityScore.bonus'),
    ...staticBase,
    ability: abilitySchema,
    value: z.number().int().min(-10).max(10),
  }),
  z.strictObject({
    type: z.literal('abilityScore.atLeast'),
    ...staticBase,
    ability: abilitySchema,
    value: z.number().int().min(1).max(30),
  }),
  z.strictObject({
    type: z.literal('abilityScore.maxIncrease'),
    ...staticBase,
    ability: abilitySchema,
    value: z.number().int().min(1).max(10),
  }),
  z.strictObject({
    type: z.literal('proficiency.grant'),
    ...staticBase,
    kind: z.enum(['skill', 'save', 'tool', 'weapon', 'armor', 'language']),
    /** skill id, ability, tool/weapon slug or uid, weapon category (`simple`/`martial`), armor category, language slug */
    target: z.string().min(1).max(120),
    level: z.enum(['proficient', 'expertise', 'half']).default('proficient'),
  }),
  z.strictObject({
    type: z.literal('bonus'),
    ...staticBase,
    ...stackable,
    target: statPathSchema,
    value: snf,
  }),
  z.strictObject({
    type: z.literal('set'),
    ...staticBase,
    ...prioritised,
    target: statPathSchema,
    value: snf,
  }),
  z.strictObject({ type: z.literal('atLeast'), ...staticBase, target: statPathSchema, value: snf }),
  z.strictObject({ type: z.literal('atMost'), ...staticBase, target: statPathSchema, value: snf }),
  z.strictObject({
    type: z.literal('multiply'),
    ...staticBase,
    target: statPathSchema,
    value: z.number().min(0).max(10),
  }),
  z.strictObject({
    type: z.literal('replaceFinal'),
    ...staticBase,
    ...prioritised,
    target: statPathSchema,
    value: snf,
  }),
  z.strictObject({
    type: z.literal('ac.formula'),
    ...staticBase,
    formula: sf,
    label: z.string().min(1).max(60),
  }),
  z.strictObject({ type: z.literal('advantage'), ...staticBase, on: rollKeySchema }),
  z.strictObject({ type: z.literal('disadvantage'), ...staticBase, on: rollKeySchema }),
  z.strictObject({
    type: z.literal('damage.resistance'),
    ...base,
    damageType: damageTypeSchema,
    condition: packetPredicateSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('damage.immunity'),
    ...base,
    damageType: damageTypeSchema,
    condition: packetPredicateSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('damage.vulnerability'),
    ...base,
    damageType: damageTypeSchema,
    condition: packetPredicateSchema.optional(),
  }),
  z.strictObject({ type: z.literal('condition.immunity'), ...staticBase, condition_: slugSchema }),
  z.strictObject({
    type: z.literal('sense.grant'),
    ...staticBase,
    sense: senseSchema,
    range: z.number().int().min(5).max(1000),
  }),
  z.strictObject({
    type: z.literal('speed.set'),
    ...staticBase,
    ...prioritised,
    mode: speedModeSchema,
    value: snf,
  }),
  z.strictObject({
    type: z.literal('speed.bonus'),
    ...staticBase,
    ...stackable,
    mode: speedModeSchema,
    value: snf,
  }),
  z.strictObject({ type: z.literal('size.set'), ...staticBase, size: sizeSchema }),
  z.strictObject({ type: z.literal('language.grant'), ...staticBase, language: slugSchema }),
  z.strictObject({
    type: z.literal('attack.extra'),
    ...staticBase,
    count: z.number().int().min(1).max(3),
  }),
  z.strictObject({
    type: z.literal('crit.range'),
    ...staticBase,
    min: z.number().int().min(2).max(20),
  }),
  z.strictObject({
    type: z.literal('weapon.property.grant'),
    ...staticBase,
    property: weaponPropertySchema,
  }),
  z.strictObject({
    type: z.literal('hp.bonusPerLevel'),
    ...staticBase,
    value: z.number().int().min(-5).max(10),
  }),
  z.strictObject({
    type: z.literal('resource.define'),
    ...staticBase,
    resource: resourceDefinitionSchema,
  }),
  z.strictObject({
    type: z.literal('spellcasting.grant'),
    ...staticBase,
    ability: abilitySchema,
    progression: z.enum(['full', 'half', 'third', 'pact', 'none']),
    preparation: z.enum(['known', 'prepared', 'spellbook']),
    list: uidSchema,
    ritual: z.boolean().default(false),
    focus: z.string().max(80).optional(),
    /** Indexed by class level (index 0 = level 1). Omit when the ruleset table applies. */
    cantripsKnownByLevel: z.array(z.number().int().min(0)).optional(),
    spellsKnownByLevel: z.array(z.number().int().min(0)).optional(),
    /** For prepared casters: `castingMod + classLevel(x)` style formula. */
    preparedFormula: sf.optional(),
  }),
  z.strictObject({
    type: z.literal('spell.grant'),
    ...staticBase,
    spell: uidSchema,
    castingAbility: abilitySchema.optional(),
    uses: z.strictObject({ max: snf, recharge: rechargeSchema }).optional(),
    atWill: z.boolean().default(false),
    castAtLevel: z.number().int().min(0).max(9).optional(),
    /** Spell is cast using this item's charges. */
    chargeCost: z.number().int().min(1).optional(),
  }),
  z.strictObject({
    type: z.literal('spellSlots.bonus'),
    ...staticBase,
    level: z.number().int().min(1).max(9),
    count: z.number().int().min(1).max(4),
  }),
  z.strictObject({
    type: z.literal('action.grant'),
    ...staticBase,
    name: z.string().min(1).max(80),
    actionType: z.enum(['action', 'bonus', 'reaction', 'free', 'special']),
    description: markdownSchema.optional(),
    attack: z
      .strictObject({
        ability: abilitySchema.optional(),
        bonus: anf.optional(),
        kind: z.enum(['melee', 'ranged', 'spell']).default('melee'),
        reach: z.number().int().optional(),
        range: z
          .strictObject({ normal: z.number().int(), long: z.number().int().optional() })
          .optional(),
      })
      .optional(),
    damage: z.array(damageLineSchema).optional(),
    save: z
      .strictObject({
        ability: abilitySchema,
        dc: z.union([z.literal('spell'), anf]),
        onSuccess: z.enum(['half', 'none', 'special']).default('none'),
      })
      .optional(),
    healing: formulaSchema('action').optional(),
    cost: actionCostSchema.optional(),
    recharge: rechargeSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('toggle.define'),
    ...staticBase,
    toggle: z.strictObject({
      id: slugSchema,
      name: z.string().min(1).max(80),
      description: markdownSchema.optional(),
      cost: actionCostSchema.optional(),
      durationNote: z.string().max(120).optional(),
      get effects() {
        return z.array(z.lazy(() => effectSchema)).default([])
      },
    }),
  }),
  z.strictObject({ type: z.literal('feature.grant'), ...staticBase, feature: uidSchema }),
  z.strictObject({
    type: z.literal('hook'),
    ...staticBase,
    hook: hookIdSchema,
    params: z.record(z.string(), z.unknown()).default({}),
  }),
  /** Descriptive-only mechanic. Shown with a "manual" badge; never counts as automation. */
  z.strictObject({ type: z.literal('manual'), ...base, text: z.string().min(1).max(2000) }),
])

// --------------------------------------------------------------------------- action effects

const actionBase = { ...base, condition: actionPredicateSchema.optional() }
const appliesTo = z
  .enum(['melee', 'ranged', 'spell', 'weapon.self', 'unarmed', 'all'])
  .default('all')

export const actionEffectSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('action.attackBonus'),
    ...actionBase,
    ...stackable,
    value: anf,
    appliesTo,
  }),
  z.strictObject({
    type: z.literal('action.damageAdd'),
    ...actionBase,
    formula: formulaSchema('action'),
    damageType: damageTypeSchema.or(z.literal('weapon')),
    appliesTo,
    /** Key tracked in state.combat.oncePerTurn (e.g. `sneak-attack`). */
    oncePerTurn: slugSchema.optional(),
    /** The player may decline (e.g. to save a resource). */
    optional: z.boolean().default(false),
    label: z.string().min(1).max(60).optional(),
  }),
  z.strictObject({
    type: z.literal('action.damageReplaceDie'),
    ...actionBase,
    die: z.enum(['d4', 'd6', 'd8', 'd10', 'd12']),
    appliesTo,
  }),
  z.strictObject({ type: z.literal('action.advantage'), ...actionBase, appliesTo }),
  z.strictObject({ type: z.literal('action.disadvantage'), ...actionBase, appliesTo }),
  z.strictObject({
    type: z.literal('action.critRange'),
    ...actionBase,
    min: z.number().int().min(2).max(20),
    appliesTo,
  }),
  z.strictObject({
    type: z.literal('action.rerollDamageDice'),
    ...actionBase,
    values: z.array(z.number().int().min(1).max(12)).min(1),
    once: z.boolean().default(true),
    appliesTo,
  }),
  z.strictObject({
    type: z.literal('action.onHit'),
    ...actionBase,
    text: z.string().min(1).max(1000),
    appliesTo,
  }),
  z.strictObject({
    type: z.literal('action.onCrit'),
    ...actionBase,
    text: z.string().min(1).max(1000),
    appliesTo,
  }),
  z.strictObject({ type: z.literal('action.saveDC'), ...actionBase, value: anf }),
  z.strictObject({ type: z.literal('action.cost'), ...actionBase, cost: actionCostSchema }),
  z.strictObject({
    type: z.literal('action.requiresChoice'),
    ...actionBase,
    key: slugSchema,
    options: z.array(z.string().min(1)).min(2),
  }),
])

/** Any effect. Static and action effects are distinguished by their `type` prefix. */
export const effectSchema: z.ZodType<Effect> = z.lazy(() =>
  z.union([staticEffectSchema, actionEffectSchema]),
) as z.ZodType<Effect>

export type StaticEffect = z.infer<typeof staticEffectSchema>
export type ActionEffect = z.infer<typeof actionEffectSchema>
export type Effect = StaticEffect | ActionEffect

export function isActionEffect(effect: Effect): effect is ActionEffect {
  return effect.type.startsWith('action.') && effect.type !== 'action.grant'
}

export const STATIC_EFFECT_TYPES = staticEffectSchema.options.map((o) => o.shape.type.value)
export const ACTION_EFFECT_TYPES = actionEffectSchema.options.map((o) => o.shape.type.value)
