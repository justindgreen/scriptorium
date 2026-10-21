import { z } from 'zod'
import { abilitySchema, rulesetIdSchema, skillSchema, uidSchema } from './ids.js'

/**
 * Ruleset configuration (docs/DATA_MODEL.md §2). Tables are arrays indexed by level - 1 and are
 * not capped at 20: `maxLevel` says how far the UI goes, the arrays may be longer.
 */
const slotRow = z.array(z.number().int().min(0).max(9)).length(9)

export const rulesetConfigSchema = z.strictObject({
  id: rulesetIdSchema,
  name: z.string().min(1).max(80),
  version: z.string().min(1).max(40),
  edition: z.enum(['2014', '2024']),
  maxLevel: z.number().int().min(1).max(100).default(20),
  abilities: z
    .array(
      z.strictObject({ id: abilitySchema, name: z.string(), abbreviation: z.string().length(3) }),
    )
    .length(6),
  skills: z
    .array(z.strictObject({ id: skillSchema, name: z.string(), ability: abilitySchema }))
    .length(18),
  proficiencyBonusByLevel: z.array(z.number().int().min(2)).min(20),
  xpByLevel: z.array(z.number().int().min(0)).min(20),
  spellSlots: z.strictObject({
    full: z.array(slotRow).min(20),
    half: z.array(slotRow).min(20),
    third: z.array(slotRow).min(20),
    /** Pact magic: slots and slot level by class level. */
    pact: z
      .array(
        z.strictObject({ slots: z.number().int().min(0), level: z.number().int().min(0).max(5) }),
      )
      .min(20),
    /** Multiclass caster-level table (index = effective caster level - 1). */
    multiclass: z.array(slotRow).min(20),
  }),
  multiclass: z.strictObject({
    /** Rounding for half and third casters when combining levels. */
    halfCasterLevelDivisor: z.literal(2),
    thirdCasterLevelDivisor: z.literal(3),
    roundHalfUpWhenSingleClass: z.boolean(),
  }),
  pointBuy: z.strictObject({
    budget: z.number().int().min(1),
    min: z.number().int().min(1),
    max: z.number().int().min(1),
    costs: z.record(z.string(), z.number().int().min(0)),
  }),
  standardArray: z.array(z.number().int()).length(6),
  abilityScoreCap: z.number().int().min(20).max(30),
  hitPointsAtFirstLevel: z.enum(['max-die-plus-con']),
  encounter: z.strictObject({
    thresholdsByLevel: z
      .array(
        z.strictObject({
          easy: z.number().int(),
          medium: z.number().int(),
          hard: z.number().int(),
          deadly: z.number().int(),
        }),
      )
      .min(20),
    multipliers: z
      .array(z.strictObject({ minMonsters: z.number().int().min(1), multiplier: z.number() }))
      .min(1),
    smallPartyShift: z.number().int(),
    largePartyShift: z.number().int(),
  }),
  rests: z.strictObject({
    shortRestMinutes: z.number().int(),
    longRestHours: z.number().int(),
    hitDiceRecoveredOnLongRest: z.enum(['half']),
    longRestRestoresAllHp: z.boolean(),
  }),
  carryingCapacityMultiplier: z.number().int(),
  conditions: z.array(uidSchema),
  exhaustion: z.array(z.string()).min(1),
  damageTypes: z.array(z.string()).min(1),
})

export type RulesetConfig = z.infer<typeof rulesetConfigSchema>
