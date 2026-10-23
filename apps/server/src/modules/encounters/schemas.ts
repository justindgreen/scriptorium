/** Input schemas for the encounters module (M2.8 thin slice). */
import { z } from 'zod'

export const encounterIdSchema = z.object({ encounterId: z.string().uuid() })

export const createEncounterSchema = z.object({
  campaignId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
})

export const addCharacterSchema = z.object({
  encounterId: z.string().uuid(),
  characterId: z.string().uuid(),
})

export const addMonsterSchema = z.object({
  encounterId: z.string().uuid(),
  uid: z.string().min(3).max(200),
  count: z.number().int().min(1).max(10).default(1),
})

export const setInitiativeSchema = z.object({
  encounterId: z.string().uuid(),
  participantId: z.string().uuid(),
  initiative: z.number().min(-20).max(60),
})

export const versionedSchema = z.object({
  encounterId: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
})

/** Which attack a participant makes: a character's action template or a monster's stat-block action. */
export const attackActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('weapon'), itemId: z.string().min(1).max(80) }),
  z.object({ kind: z.literal('unarmed') }),
  z.object({ kind: z.literal('action'), templateId: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('monster'), index: z.number().int().min(0).max(20) }),
  z.object({
    kind: z.literal('spell'),
    spellUid: z.string().min(3).max(200),
    slotLevel: z.number().int().min(1).max(9).optional(),
  }),
])

export const attackSchema = z.object({
  encounterId: z.string().uuid(),
  attackerId: z.string().uuid(),
  targetId: z.string().uuid(),
  action: attackActionSchema,
  advantage: z.enum(['normal', 'advantage', 'disadvantage']).default('normal'),
})

export const commitAttackSchema = z.object({
  encounterId: z.string().uuid(),
  commandId: z.string().uuid(),
  rollId: z.string().uuid(),
  /** For a saving-throw spell: whether the target succeeded (the table rolls the save). */
  saved: z.boolean().optional(),
  expectedVersion: z.number().int().min(0),
})

export const setConditionSchema = z.object({
  encounterId: z.string().uuid(),
  participantId: z.string().uuid(),
  uid: z.string().min(3).max(200),
  active: z.boolean(),
})

export const adjustHpSchema = z.object({
  encounterId: z.string().uuid(),
  participantId: z.string().uuid(),
  delta: z.number().int().min(-1000).max(1000),
})
