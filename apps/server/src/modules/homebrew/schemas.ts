/** Input schemas for the homebrew module (M2.7: sources and the magic item editor). */
import { automationSchema, effectSchema, itemDataSchema } from '@scriptorium/content-schema'
import { z } from 'zod'

export const createSourceSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
})

/**
 * What the editor sends: the item's data block, its effects and (optionally) an automation
 * declaration. Everything is validated again as a full content entry before it is stored.
 */
export const itemDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  data: itemDataSchema,
  effects: z.array(effectSchema).max(40),
  automation: automationSchema.optional(),
  changeNote: z.string().trim().max(300).optional(),
})

export type ItemDraftInput = z.infer<typeof itemDraftSchema>

export const createItemSchema = z.object({
  sourceId: z.string().uuid(),
  draft: itemDraftSchema,
})

export const saveItemSchema = z.object({
  entryId: z.string().uuid(),
  draft: itemDraftSchema,
})

export const entryIdSchema = z.object({ entryId: z.string().uuid() })

export const previewSchema = z.object({
  entryId: z.string().uuid(),
  characterId: z.string().uuid(),
  /** Creature type of an imagined target, so target-typed riders show up in the plan. */
  targetType: z.string().max(40).optional(),
})
