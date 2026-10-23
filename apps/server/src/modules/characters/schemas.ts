/** Input schemas for the characters module. Commands are validated before the engine sees them. */
import { ABILITIES, SKILLS, contentEntrySchema } from '@scriptorium/content-schema'
import { z } from 'zod'

const uid = z.string().min(3).max(200)
const abilityScores = z.object({
  str: z.number().int(),
  dex: z.number().int(),
  con: z.number().int(),
  int: z.number().int(),
  wis: z.number().int(),
  cha: z.number().int(),
})
const increases = z.object(
  Object.fromEntries(
    ABILITIES.map((a) => [a, z.number().int().min(0).max(4).optional()]),
  ) as Record<(typeof ABILITIES)[number], z.ZodOptional<z.ZodNumber>>,
)

export const choiceSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('optionSet'), options: z.array(z.string().min(1)).max(20) }),
  z.object({ kind: z.literal('skill'), skills: z.array(z.enum(SKILLS)).max(20) }),
  z.object({ kind: z.literal('tool'), tools: z.array(z.string().min(1)).max(20) }),
  z.object({ kind: z.literal('language'), languages: z.array(z.string().min(1)).max(20) }),
  z.object({ kind: z.literal('abilityIncrease'), increases }),
  z.object({ kind: z.literal('feat'), feats: z.array(uid).max(10) }),
  z.object({ kind: z.literal('content'), entries: z.array(uid).max(50) }),
  z.object({ kind: z.literal('expertise'), skills: z.array(z.enum(SKILLS)).max(20) }),
  z.object({
    kind: z.literal('asiOrFeat'),
    choice: z.enum(['asi', 'feat']),
    increases: increases.optional(),
    feat: uid.optional(),
  }),
])

const customItem = contentEntrySchema.refine(
  (e) => e.kind === 'item',
  'custom items must be item entries',
)

const spellRow = z.object({
  spellUid: uid,
  origin: z.string().min(1).max(200),
  known: z.boolean(),
  prepared: z.boolean(),
  alwaysPrepared: z.boolean(),
})

const costSpec = z.object({
  kind: z.enum(['resource', 'slot', 'pact', 'charges']),
  id: z.string().optional(),
  level: z.number().int().optional(),
  amount: z.number().int().min(0),
  available: z.number().int(),
  sufficient: z.boolean(),
})

export const actionRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('weapon'),
    itemId: z.string(),
    twoHanded: z.boolean().optional(),
    thrown: z.boolean().optional(),
  }),
  z.object({ kind: z.literal('unarmed') }),
  z.object({ kind: z.literal('action'), templateId: z.string() }),
  z.object({
    kind: z.literal('spell'),
    spellUid: uid,
    slotLevel: z.number().int().min(0).max(9).optional(),
    sourceId: z.string().optional(),
    usePact: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('check'),
    skill: z.enum(SKILLS).optional(),
    ability: z.enum(ABILITIES).optional(),
  }),
  z.object({ kind: z.literal('save'), ability: z.enum(ABILITIES) }),
])

const actionOutcome = z.object({
  ref: actionRefSchema,
  name: z.string(),
  attack: z
    .object({
      natural: z.number().int(),
      total: z.number().int(),
      critical: z.boolean(),
      naturalOne: z.boolean(),
      hit: z.boolean().nullable(),
      targetAc: z.number().int().optional(),
    })
    .optional(),
  check: z.object({ natural: z.number().int(), total: z.number().int() }).optional(),
  save: z
    .object({
      ability: z.enum(ABILITIES),
      dc: z.number().int(),
      onSuccess: z.enum(['half', 'none', 'special']),
    })
    .optional(),
  packets: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      amount: z.number().int().min(0),
      damageType: z.string(),
      flags: z.object({
        magical: z.boolean(),
        silvered: z.boolean(),
        adamantine: z.boolean(),
        fromSpell: z.boolean(),
        weapon: z.boolean(),
      }),
    }),
  ),
  healing: z.number().int().min(0).optional(),
  costs: z.array(costSpec),
  oncePerTurnMarks: z.array(z.string()),
  economyMark: z.enum(['action', 'bonus', 'reaction', 'free', 'special']).optional(),
  concentration: z.boolean().optional(),
})

const amount = z.number().int().min(0).max(100_000)

export const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('addItem'),
    itemId: z.string().min(1).max(80).optional(),
    itemUid: uid.optional(),
    customItem: customItem.optional(),
    quantity: z.number().int().min(1).max(10_000).optional(),
    equipped: z.boolean().optional(),
    chargesCurrent: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('removeItem'), itemId: z.string() }),
  z.object({ type: z.literal('equip'), itemId: z.string() }),
  z.object({ type: z.literal('unequip'), itemId: z.string() }),
  z.object({ type: z.literal('attune'), itemId: z.string() }),
  z.object({ type: z.literal('unattune'), itemId: z.string() }),
  z.object({
    type: z.literal('spendCharges'),
    itemId: z.string(),
    amount: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal('recharge'),
    itemId: z.string(),
    amount: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal('applyDamage'),
    amount,
    damageType: z.string().optional(),
    magical: z.boolean().optional(),
  }),
  z.object({ type: z.literal('heal'), amount }),
  z.object({ type: z.literal('setTempHp'), amount }),
  z.object({ type: z.literal('spendSlot'), level: z.number().int().min(1).max(9) }),
  z.object({ type: z.literal('restoreSlot'), level: z.number().int().min(1).max(9) }),
  z.object({ type: z.literal('spendPactSlot') }),
  z.object({ type: z.literal('restorePactSlot') }),
  z.object({
    type: z.literal('useResource'),
    id: z.string(),
    amount: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal('restoreResource'),
    id: z.string(),
    amount: z.number().int().min(1).optional(),
  }),
  z.object({
    type: z.literal('applyCondition'),
    uid,
    level: z.number().int().min(1).max(6).optional(),
  }),
  z.object({ type: z.literal('removeCondition'), uid }),
  z.object({ type: z.literal('setExhaustion'), level: z.number().int().min(0).max(6) }),
  z.object({ type: z.literal('toggle'), id: z.string(), active: z.boolean() }),
  z.object({
    type: z.literal('adjustCurrency'),
    delta: z.object({
      cp: z.number().int().optional(),
      sp: z.number().int().optional(),
      ep: z.number().int().optional(),
      gp: z.number().int().optional(),
      pp: z.number().int().optional(),
    }),
  }),
  z.object({ type: z.literal('setInspiration'), value: z.boolean() }),
  z.object({
    type: z.literal('shortRest'),
    hitDice: z
      .array(
        z.object({
          die: z.enum(['d4', 'd6', 'd8', 'd10', 'd12']),
          roll: z.number().int().min(1).max(12),
        }),
      )
      .max(40)
      .optional(),
  }),
  z.object({ type: z.literal('longRest') }),
  z.object({
    type: z.literal('turnStarted'),
    turnId: z.string().min(1),
    ownTurn: z.boolean(),
    encounterId: z.string().nullable().optional(),
    round: z.number().int().nullable().optional(),
  }),
  z.object({ type: z.literal('applyActionOutcome'), outcome: actionOutcome }),
  z.object({ type: z.literal('setName'), name: z.string().min(1).max(80) }),
  z.object({
    type: z.literal('setAbilities'),
    method: z.enum(['standard', 'point_buy', 'manual', 'rolled']),
    abilities: abilityScores,
  }),
  z.object({ type: z.literal('setSpecies'), uid: uid.nullable() }),
  z.object({ type: z.literal('setBackground'), uid: uid.nullable() }),
  z.object({
    type: z.literal('addClassLevel'),
    classUid: uid,
    subclassUid: uid.optional(),
    hitDieRoll: z.number().int().min(1).max(12).optional(),
  }),
  z.object({ type: z.literal('removeClassLevel'), classUid: uid }),
  z.object({ type: z.literal('setSubclass'), classUid: uid, subclassUid: uid.nullable() }),
  z.object({
    type: z.literal('setChoice'),
    key: z.string().min(1).max(300),
    selection: choiceSelectionSchema,
  }),
  z.object({ type: z.literal('clearChoice'), key: z.string().min(1).max(300) }),
  z.object({ type: z.literal('setSpells'), spells: z.array(spellRow).max(400) }),
  z.object({ type: z.literal('setHpMode'), mode: z.enum(['fixed', 'rolled', 'manual']) }),
  z.object({
    type: z.literal('setOverride'),
    statPath: z.string().min(1).max(120),
    value: z.union([z.number(), z.string().max(80), z.boolean()]),
    note: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal('clearOverride'), statPath: z.string().min(1).max(120) }),
  z.object({
    type: z.literal('setAssumption'),
    id: z.string().min(1).max(120),
    value: z.unknown(),
  }),
])

export type CommandInput = z.infer<typeof commandSchema>

export const actionContextSchema = z.object({
  target: z
    .object({
      name: z.string().max(80).optional(),
      creatureType: z.string().max(40).optional(),
      size: z.string().max(20).optional(),
      conditions: z.array(z.string().max(40)).max(20).optional(),
      ac: z.number().int().min(0).max(40).optional(),
    })
    .optional(),
  situation: z
    .object({
      advantageSources: z.array(z.string().max(60)).max(10).optional(),
      disadvantageSources: z.array(z.string().max(60)).max(10).optional(),
      allyAdjacentToTarget: z.boolean().optional(),
      hidden: z.boolean().optional(),
      firstAttackThisTurn: z.boolean().optional(),
      range: z.enum(['normal', 'long']).optional(),
    })
    .optional(),
  options: z
    .object({
      declineOptional: z.array(z.string().max(80)).max(20).optional(),
      answers: z.record(z.string().max(80), z.unknown()).optional(),
    })
    .optional(),
})

export const planRequestSchema = z.object({
  characterId: z.string().uuid(),
  ref: actionRefSchema,
  ctx: actionContextSchema.default({}),
})

export const hitDieRequestSchema = z.object({
  characterId: z.string().uuid(),
  die: z.enum(['d4', 'd6', 'd8', 'd10', 'd12']),
})

export const commitRollSchema = z.object({
  characterId: z.string().uuid(),
  commandId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  rollId: z.string().uuid(),
  targetAc: z.number().int().min(0).max(40).optional(),
})

export const commandRequestSchema = z.object({
  characterId: z.string().uuid(),
  commandId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  command: commandSchema,
  /** `setAbilities` with the Rolled method names the recorded server roll it applies. */
  abilityRollId: z.string().uuid().optional(),
})

export const createCharacterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  rulesetId: z.string().min(1).max(60).default('srd5.1-2014'),
  abilityMethod: z.enum(['standard', 'point_buy', 'manual', 'rolled']).default('standard'),
  baseAbilities: abilityScores.optional(),
  /** Required with `abilityMethod: 'rolled'`: the recorded server roll the scores come from. */
  abilityRollId: z.string().uuid().optional(),
  speciesUid: uid.optional(),
  backgroundUid: uid.optional(),
  classUid: uid.optional(),
  hpMode: z.enum(['fixed', 'rolled', 'manual']).default('fixed'),
})
