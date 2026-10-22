/** Input schemas for the campaigns module (M2.8 thin slice). */
import { z } from 'zod'

export const campaignIdSchema = z.object({ campaignId: z.string().uuid() })

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(4000).optional(),
})

export const createInviteSchema = z.object({
  campaignId: z.string().uuid(),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(24 * 14),
  maxUses: z.number().int().min(1).max(100).default(10),
})

export const joinSchema = z.object({ code: z.string().trim().min(8).max(40) })

export const campaignCharacterSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid(),
})

export const shareSourceSchema = z.object({
  campaignId: z.string().uuid(),
  sourceId: z.string().uuid(),
  enabled: z.boolean().default(true),
})
