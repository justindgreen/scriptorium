import { z } from 'zod'
import { abilitySchema, contentKindSchema, skillSchema, slugSchema, uidSchema } from './ids.js'
import { staticPredicateSchema } from './predicates.js'

/**
 * Choice points (docs/RULES_ENGINE.md §5). The engine computes legal options per character and
 * emits pending choices; the builder stores selections under a stable choice key.
 */
export const choiceSourceSchema = z.discriminatedUnion('kind', [
  /** Pick among explicit options; each option grants effects. */
  z.strictObject({
    kind: z.literal('optionSet'),
    options: z
      .array(
        z.strictObject({
          id: slugSchema,
          name: z.string().min(1).max(80),
          description: z.string().max(4000).optional(),
          prerequisite: staticPredicateSchema.optional(),
          /** Effects granted when chosen (validated as effects by the entry schema). */
          effects: z.array(z.unknown()).default([]),
          /** Or grant a whole feature entry. */
          feature: uidSchema.optional(),
        }),
      )
      .min(1),
  }),
  z.strictObject({
    kind: z.literal('skill'),
    from: z.array(skillSchema).min(1).optional(),
    expertise: z.boolean().default(false),
  }),
  z.strictObject({ kind: z.literal('tool'), from: z.array(z.string().min(1)).min(1).optional() }),
  z.strictObject({ kind: z.literal('language'), from: z.array(slugSchema).min(1).optional() }),
  z.strictObject({
    kind: z.literal('abilityIncrease'),
    points: z.number().int().min(1).max(4),
    maxPerAbility: z.number().int().min(1).max(2).default(2),
    cap: z.number().int().min(10).max(30).default(20),
    from: z.array(abilitySchema).min(1).optional(),
  }),
  z.strictObject({ kind: z.literal('feat') }),
  /** Choose content entries of a kind matching a filter (spells of a list and level, etc.). */
  z.strictObject({
    kind: z.literal('content'),
    contentKind: contentKindSchema,
    filter: z
      .strictObject({
        list: uidSchema.optional(),
        maxLevel: z.number().int().min(0).max(9).optional(),
        level: z.number().int().min(0).max(9).optional(),
        tags: z.array(z.string()).optional(),
        school: z.string().optional(),
      })
      .default({}),
  }),
  /** Expertise in a skill the character is already proficient in. */
  z.strictObject({ kind: z.literal('expertise'), fromProficient: z.literal(true).default(true) }),
  /** Choose between an ability score increase and a feat (the standard ASI choice). */
  z.strictObject({ kind: z.literal('asiOrFeat') }),
])

export const choiceSchema = z.strictObject({
  type: z.literal('choice'),
  key: slugSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  count: z.number().int().min(1).max(10).default(1),
  from: choiceSourceSchema,
  prerequisite: staticPredicateSchema.optional(),
})

export type Choice = z.infer<typeof choiceSchema>
