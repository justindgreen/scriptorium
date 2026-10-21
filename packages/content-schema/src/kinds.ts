import { z } from 'zod'
import { formulaSchema } from './formula.js'
import {
  abilitySchema,
  armorCategorySchema,
  creatureTypeSchema,
  damageTypeSchema,
  markdownSchema,
  sizeSchema,
  skillSchema,
  slugSchema,
  speedModeSchema,
  uidSchema,
  weaponPropertySchema,
} from './ids.js'
import { staticPredicateSchema } from './predicates.js'

/** Per-kind `data` payloads. Mechanics live in the entry's `effects`/`choices`, not here. */

const nameRef = z.strictObject({ uid: uidSchema, name: z.string().min(1) })

export const spellDataSchema = z.strictObject({
  level: z.number().int().min(0).max(9),
  school: z.enum([
    'abjuration',
    'conjuration',
    'divination',
    'enchantment',
    'evocation',
    'illusion',
    'necromancy',
    'transmutation',
  ]),
  castingTime: z.string().min(1).max(120),
  castingTimeType: z.enum(['action', 'bonus', 'reaction', 'minute', 'hour', 'special']),
  range: z.string().min(1).max(120),
  components: z.strictObject({
    verbal: z.boolean(),
    somatic: z.boolean(),
    material: z.boolean(),
    materialText: z.string().max(500).optional(),
  }),
  duration: z.string().min(1).max(120),
  concentration: z.boolean(),
  ritual: z.boolean(),
  description: markdownSchema,
  higherLevels: markdownSchema.optional(),
  /** Class entry uids whose lists include this spell (also mirrored in spell_list entries). */
  classes: z.array(uidSchema).default([]),
  subclasses: z.array(uidSchema).default([]),
  attackType: z.enum(['melee', 'ranged']).optional(),
  save: z
    .strictObject({
      ability: abilitySchema,
      onSuccess: z.enum(['half', 'none', 'special']).default('none'),
    })
    .optional(),
  damage: z
    .strictObject({
      damageType: damageTypeSchema.optional(),
      /** Dice by slot level (`"3": "8d6"`) or by character level for cantrips. */
      bySlotLevel: z.record(z.string(), z.string()).optional(),
      byCharacterLevel: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  healing: z.record(z.string(), z.string()).optional(),
  areaOfEffect: z
    .strictObject({
      shape: z.enum(['sphere', 'cube', 'cone', 'line', 'cylinder']),
      size: z.number().int(),
    })
    .optional(),
})

export const weaponDataSchema = z.strictObject({
  category: z.enum(['simple', 'martial']),
  range: z.enum(['melee', 'ranged']),
  damage: z
    .strictObject({ dice: z.string().regex(/^\d+d\d+$/), damageType: damageTypeSchema })
    .optional(),
  versatileDamage: z
    .string()
    .regex(/^\d+d\d+$/)
    .optional(),
  properties: z.array(weaponPropertySchema).default([]),
  normalRange: z.number().int().optional(),
  longRange: z.number().int().optional(),
  throwNormalRange: z.number().int().optional(),
  throwLongRange: z.number().int().optional(),
})

export const armorDataSchema = z.strictObject({
  category: armorCategorySchema,
  baseAc: z.number().int().min(10).max(20),
  addDexModifier: z.boolean(),
  maxDexBonus: z.number().int().min(0).max(5).optional(),
  strengthMinimum: z.number().int().min(0).max(20).optional(),
  stealthDisadvantage: z.boolean().default(false),
})

export const itemDataSchema = z.strictObject({
  category: z.enum([
    'weapon',
    'armor',
    'shield',
    'adventuring-gear',
    'tool',
    'mount',
    'vehicle',
    'trade-good',
    'consumable',
    'wondrous',
    'ring',
    'rod',
    'staff',
    'wand',
    'scroll',
    'potion',
    'ammunition',
    'other',
  ]),
  subcategory: z.string().max(80).optional(),
  description: markdownSchema,
  cost: z
    .strictObject({ quantity: z.number().min(0), unit: z.enum(['cp', 'sp', 'ep', 'gp', 'pp']) })
    .optional(),
  weight: z.number().min(0).optional(),
  magic: z.boolean().default(false),
  rarity: z
    .enum(['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact', 'varies'])
    .optional(),
  requiresAttunement: z.boolean().default(false),
  attunementPrerequisite: z.string().max(200).optional(),
  weapon: weaponDataSchema.optional(),
  armor: armorDataSchema.optional(),
  charges: z
    .strictObject({
      max: z.union([z.number().int().min(1), formulaSchema('static')]),
      recharge: z.strictObject({
        time: z.enum(['dawn', 'dusk', 'longRest', 'shortRest', 'never']),
        formula: formulaSchema('static').optional(),
      }),
      destroyedOnLastCharge: z.string().max(200).optional(),
    })
    .optional(),
  /** Items that come in several variants in the source text (e.g. +1/+2/+3). */
  variantOf: uidSchema.optional(),
  quantityPerPurchase: z.number().int().min(1).optional(),
})

const monsterActionSchema = z.strictObject({
  name: z.string().min(1).max(120),
  description: markdownSchema,
  attack: z
    .strictObject({
      kind: z.enum(['melee', 'ranged', 'melee-or-ranged', 'spell-melee', 'spell-ranged']),
      toHit: z.number().int(),
      reach: z.number().int().optional(),
      range: z
        .strictObject({ normal: z.number().int(), long: z.number().int().optional() })
        .optional(),
      targets: z.string().max(80).optional(),
    })
    .optional(),
  damage: z
    .array(
      z.strictObject({
        dice: z.string().max(40),
        damageType: damageTypeSchema.optional(),
        note: z.string().max(120).optional(),
      }),
    )
    .default([]),
  save: z
    .strictObject({
      ability: abilitySchema,
      dc: z.number().int(),
      onSuccess: z.enum(['half', 'none', 'special']).default('none'),
    })
    .optional(),
  recharge: z.string().max(20).optional(),
  usage: z.string().max(80).optional(),
})

export const monsterDataSchema = z.strictObject({
  size: sizeSchema,
  type: creatureTypeSchema,
  subtype: z.string().max(60).optional(),
  alignment: z.string().max(60),
  armorClass: z
    .array(z.strictObject({ value: z.number().int(), source: z.string().max(80).optional() }))
    .min(1),
  hitPoints: z.strictObject({ average: z.number().int().min(1), formula: z.string().max(40) }),
  speed: z.partialRecord(
    speedModeSchema.or(z.literal('hover')),
    z.union([z.number().int(), z.boolean()]),
  ),
  abilities: z.strictObject({
    str: z.number().int(),
    dex: z.number().int(),
    con: z.number().int(),
    int: z.number().int(),
    wis: z.number().int(),
    cha: z.number().int(),
  }),
  savingThrows: z.partialRecord(abilitySchema, z.number().int()).default({}),
  skills: z.partialRecord(skillSchema, z.number().int()).default({}),
  damageVulnerabilities: z.array(z.string()).default([]),
  damageResistances: z.array(z.string()).default([]),
  damageImmunities: z.array(z.string()).default([]),
  conditionImmunities: z.array(slugSchema).default([]),
  senses: z.record(z.string(), z.union([z.number().int(), z.string()])).default({}),
  languages: z.string().max(300).default(''),
  challengeRating: z.number().min(0).max(30),
  xp: z.number().int().min(0),
  proficiencyBonus: z.number().int().min(2).max(9),
  traits: z
    .array(z.strictObject({ name: z.string().min(1).max(120), description: markdownSchema }))
    .default([]),
  actions: z.array(monsterActionSchema).default([]),
  bonusActions: z.array(monsterActionSchema).default([]),
  reactions: z.array(monsterActionSchema).default([]),
  legendaryActions: z
    .strictObject({
      count: z.number().int().min(1).default(3),
      description: markdownSchema.optional(),
      actions: z.array(monsterActionSchema),
    })
    .optional(),
  description: markdownSchema.optional(),
  image: z.string().max(300).optional(),
})

export const conditionDataSchema = z.strictObject({
  description: markdownSchema,
  /** Exhaustion has levels; others do not. */
  levels: z
    .array(z.strictObject({ level: z.number().int().min(1), description: z.string().max(500) }))
    .optional(),
})

export const ruleDataSchema = z.strictObject({
  category: z.string().min(1).max(80),
  description: markdownSchema,
  parent: uidSchema.optional(),
  order: z.number().int().optional(),
})

export const featureDataSchema = z.strictObject({
  description: markdownSchema,
  /** Level at which a class/subclass grants it (informational; the owner's level table is authoritative). */
  level: z.number().int().min(1).max(100).optional(),
  /** Owning class/subclass/species uid, for display and search. */
  owner: uidSchema.optional(),
  /** Feature this one replaces or improves at a higher level. */
  replaces: uidSchema.optional(),
})

const proficiencyChoice = z.strictObject({
  count: z.number().int().min(1),
  from: z.array(z.string().min(1)).min(1),
})

export const classDataSchema = z.strictObject({
  description: markdownSchema,
  hitDie: z.enum(['d6', 'd8', 'd10', 'd12']),
  primaryAbilities: z.array(abilitySchema).min(1),
  savingThrows: z.array(abilitySchema).length(2),
  proficiencies: z.strictObject({
    armor: z.array(z.string()).default([]),
    weapons: z.array(z.string()).default([]),
    tools: z.array(z.string()).default([]),
    toolChoice: proficiencyChoice.optional(),
    skills: proficiencyChoice,
  }),
  startingEquipment: z
    .array(z.strictObject({ item: uidSchema, quantity: z.number().int().min(1).default(1) }))
    .default([]),
  startingEquipmentOptions: z
    .array(
      z.strictObject({
        description: z.string().min(1).max(300),
        choose: z.number().int().min(1).default(1),
        options: z.array(
          z.strictObject({
            description: z.string().min(1).max(200),
            items: z
              .array(
                z.strictObject({ item: uidSchema, quantity: z.number().int().min(1).default(1) }),
              )
              .default([]),
          }),
        ),
      }),
    )
    .default([]),
  startingWealth: z.string().max(40).optional(),
  levels: z
    .array(
      z.strictObject({
        level: z.number().int().min(1).max(100),
        proficiencyBonus: z.number().int().min(2),
        features: z.array(uidSchema).default([]),
        /** Class-specific columns (rages, ki points, sneak attack dice...), by slug. */
        columns: z.record(z.string(), z.union([z.number(), z.string()])).default({}),
        spellSlots: z.array(z.number().int().min(0)).optional(),
        cantripsKnown: z.number().int().min(0).optional(),
        spellsKnown: z.number().int().min(0).optional(),
      }),
    )
    .min(1),
  subclassLevel: z.number().int().min(1).max(20),
  subclassTitle: z.string().min(1).max(60),
  spellcasting: z
    .strictObject({
      ability: abilitySchema,
      progression: z.enum(['full', 'half', 'third', 'pact']),
      preparation: z.enum(['known', 'prepared', 'spellbook']),
      list: uidSchema,
      startsAtLevel: z.number().int().min(1).max(20).default(1),
    })
    .optional(),
  multiclassing: z
    .strictObject({
      prerequisite: staticPredicateSchema.optional(),
      prerequisiteText: z.string().max(200).optional(),
      proficiencies: z
        .strictObject({
          armor: z.array(z.string()).default([]),
          weapons: z.array(z.string()).default([]),
          tools: z.array(z.string()).default([]),
          skills: proficiencyChoice.optional(),
        })
        .default({ armor: [], weapons: [], tools: [] }),
    })
    .optional(),
})

export const subclassDataSchema = z.strictObject({
  description: markdownSchema,
  class: uidSchema,
  flavor: z.string().max(80).optional(),
  levels: z
    .array(
      z.strictObject({
        level: z.number().int().min(1).max(100),
        features: z.array(uidSchema).default([]),
      }),
    )
    .min(1),
  /** Always-prepared spells by level (domain/oath/circle spells). */
  spells: z
    .array(
      z.strictObject({ level: z.number().int().min(1).max(20), spells: z.array(uidSchema).min(1) }),
    )
    .default([]),
  spellcasting: z
    .strictObject({
      ability: abilitySchema,
      progression: z.enum(['third']),
      preparation: z.enum(['known', 'spellbook']),
      list: uidSchema,
    })
    .optional(),
})

export const speciesDataSchema = z.strictObject({
  description: markdownSchema,
  /** Subraces point at their parent; a character picks a leaf and inherits the chain. */
  parent: uidSchema.optional(),
  size: sizeSchema.optional(),
  sizeDescription: z.string().max(500).optional(),
  speed: z.number().int().min(0).optional(),
  age: z.string().max(1000).optional(),
  alignment: z.string().max(1000).optional(),
  languageDescription: z.string().max(500).optional(),
  /** Trait feature uids, in display order. */
  traits: z.array(nameRef).default([]),
})

export const backgroundDataSchema = z.strictObject({
  description: markdownSchema,
  skillProficiencies: z.array(skillSchema).default([]),
  toolProficiencies: z.array(z.string()).default([]),
  languages: z.number().int().min(0).default(0),
  equipment: z
    .array(z.strictObject({ item: uidSchema, quantity: z.number().int().min(1).default(1) }))
    .default([]),
  equipmentDescription: z.string().max(1000).optional(),
  feature: z.strictObject({ name: z.string().min(1).max(80), description: markdownSchema }),
  characteristics: z
    .strictObject({
      personalityTraits: z.array(z.string()).default([]),
      ideals: z.array(z.string()).default([]),
      bonds: z.array(z.string()).default([]),
      flaws: z.array(z.string()).default([]),
    })
    .optional(),
})

export const featDataSchema = z.strictObject({
  description: markdownSchema,
  prerequisite: staticPredicateSchema.optional(),
  prerequisiteText: z.string().max(200).optional(),
})

export const spellListDataSchema = z.strictObject({
  description: z.string().max(500).optional(),
  class: uidSchema.optional(),
  spells: z.array(uidSchema),
})

export const resourceDataSchema = z.strictObject({
  description: markdownSchema.optional(),
  max: z.union([z.number().int().min(0), formulaSchema('static')]),
  recharge: z.enum(['shortRest', 'longRest', 'dawn', 'dusk', 'turn', 'none']),
  displayDie: z.enum(['d4', 'd6', 'd8', 'd10', 'd12']).optional(),
})

export const KIND_DATA_SCHEMAS = {
  class: classDataSchema,
  subclass: subclassDataSchema,
  species: speciesDataSchema,
  background: backgroundDataSchema,
  feat: featDataSchema,
  feature: featureDataSchema,
  spell: spellDataSchema,
  spell_list: spellListDataSchema,
  item: itemDataSchema,
  monster: monsterDataSchema,
  condition: conditionDataSchema,
  rule: ruleDataSchema,
  resource: resourceDataSchema,
} as const

export type SpellData = z.infer<typeof spellDataSchema>
export type ItemData = z.infer<typeof itemDataSchema>
export type MonsterData = z.infer<typeof monsterDataSchema>
export type ClassData = z.infer<typeof classDataSchema>
export type SubclassData = z.infer<typeof subclassDataSchema>
export type SpeciesData = z.infer<typeof speciesDataSchema>
export type BackgroundData = z.infer<typeof backgroundDataSchema>
export type FeatData = z.infer<typeof featDataSchema>
export type FeatureData = z.infer<typeof featureDataSchema>
export type ConditionData = z.infer<typeof conditionDataSchema>
export type RuleData = z.infer<typeof ruleDataSchema>
export type SpellListData = z.infer<typeof spellListDataSchema>
export type ResourceData = z.infer<typeof resourceDataSchema>
