import { z } from 'zod'
import {
  abilitySchema,
  armorCategorySchema,
  creatureTypeSchema,
  damageTypeSchema,
  sizeSchema,
  slugSchema,
  uidSchema,
  weaponPropertySchema,
} from './ids.js'
import { statPathSchema } from './statPaths.js'

/**
 * Predicates are data. Three scopes (docs/RULES_ENGINE.md §4): static leaves may appear on any
 * effect; action leaves only on action-scoped effects; packet leaves only on defenses. A static
 * effect that uses an action or packet leaf fails validation (SCOPE_VIOLATION).
 */

const staticLeaves = [
  z.strictObject({
    leaf: z.literal('equipped'),
    item: z.union([z.literal('self'), uidSchema]).default('self'),
  }),
  z.strictObject({
    leaf: z.literal('attuned'),
    item: z.union([z.literal('self'), uidSchema]).default('self'),
  }),
  z.strictObject({
    leaf: z.literal('armor'),
    category: z.enum(['none', 'light', 'medium', 'heavy', 'any']),
  }),
  z.strictObject({ leaf: z.literal('shield'), value: z.boolean() }),
  z.strictObject({ leaf: z.literal('level'), gte: z.number().int().min(1).max(100) }),
  z.strictObject({
    leaf: z.literal('classLevel'),
    class: uidSchema,
    gte: z.number().int().min(1).max(100),
  }),
  z.strictObject({
    leaf: z.literal('abilityScore'),
    ability: abilitySchema,
    gte: z.number().int().min(1).max(30),
  }),
  z.strictObject({ leaf: z.literal('proficient'), path: statPathSchema }),
  z.strictObject({ leaf: z.literal('hasCondition'), condition: slugSchema }),
  z.strictObject({ leaf: z.literal('toggle'), id: slugSchema }),
  z.strictObject({ leaf: z.literal('hasFeature'), feature: uidSchema }),
  z.strictObject({ leaf: z.literal('subclass'), subclass: uidSchema }),
  z.strictObject({ leaf: z.literal('species'), species: uidSchema }),
  z.strictObject({
    leaf: z.literal('wearingArmorCategory'),
    categories: z.array(armorCategorySchema).min(1),
  }),
] as const

const actionLeaves = [
  z.strictObject({ leaf: z.literal('ctx.weaponProperty'), property: weaponPropertySchema }),
  z.strictObject({
    leaf: z.literal('ctx.weaponCategory'),
    category: z.enum(['simple', 'martial']),
  }),
  z.strictObject({
    leaf: z.literal('ctx.attackType'),
    type: z.enum(['melee', 'ranged', 'spell', 'save']),
  }),
  z.strictObject({ leaf: z.literal('ctx.targetType'), types: z.array(creatureTypeSchema).min(1) }),
  z.strictObject({ leaf: z.literal('ctx.targetSize'), sizes: z.array(sizeSchema).min(1) }),
  z.strictObject({ leaf: z.literal('ctx.targetHasCondition'), condition: slugSchema }),
  z.strictObject({ leaf: z.literal('ctx.hasAdvantage') }),
  z.strictObject({ leaf: z.literal('ctx.allyAdjacent') }),
  z.strictObject({ leaf: z.literal('ctx.firstAttackThisTurn') }),
  z.strictObject({ leaf: z.literal('ctx.oncePerTurnAvailable'), key: slugSchema }),
  z.strictObject({ leaf: z.literal('ctx.slotLevel'), gte: z.number().int().min(1).max(9) }),
  z.strictObject({ leaf: z.literal('ctx.isMonkWeapon') }),
  /** The spell being cast (for invocations such as Agonizing Blast). */
  z.strictObject({ leaf: z.literal('ctx.spell'), spell: uidSchema }),
  z.strictObject({ leaf: z.literal('ctx.twoHanded') }),
  z.strictObject({ leaf: z.literal('ctx.wieldingOneHanded') }),
] as const

const packetLeaves = [
  z.strictObject({ leaf: z.literal('packet.magical') }),
  z.strictObject({ leaf: z.literal('packet.silvered') }),
  z.strictObject({ leaf: z.literal('packet.adamantine') }),
  z.strictObject({ leaf: z.literal('packet.fromSpell') }),
  z.strictObject({ leaf: z.literal('packet.type'), types: z.array(damageTypeSchema).min(1) }),
] as const

type Leaf =
  | z.infer<(typeof staticLeaves)[number]>
  | z.infer<(typeof actionLeaves)[number]>
  | z.infer<(typeof packetLeaves)[number]>

export type Predicate = Leaf | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate }

function composite<L extends z.ZodTypeAny>(leafSchema: L): z.ZodType<Predicate> {
  const schema: z.ZodType<Predicate> = z.lazy(() =>
    z.union([
      leafSchema,
      z.strictObject({ all: z.array(schema).min(1) }),
      z.strictObject({ any: z.array(schema).min(1) }),
      z.strictObject({ not: schema }),
    ]),
  ) as z.ZodType<Predicate>
  return schema
}

/** Facts known from the character alone. */
export const staticPredicateSchema = composite(z.discriminatedUnion('leaf', [...staticLeaves]))
/** Static facts plus the attack/target/turn context. */
export const actionPredicateSchema = composite(
  z.discriminatedUnion('leaf', [...staticLeaves, ...actionLeaves]),
)
/** Static facts plus properties of an incoming damage packet. */
export const packetPredicateSchema = composite(
  z.discriminatedUnion('leaf', [...staticLeaves, ...packetLeaves]),
)

export const STATIC_LEAF_NAMES = staticLeaves.map((l) => l.shape.leaf.value)
export const ACTION_LEAF_NAMES = actionLeaves.map((l) => l.shape.leaf.value)
export const PACKET_LEAF_NAMES = packetLeaves.map((l) => l.shape.leaf.value)
