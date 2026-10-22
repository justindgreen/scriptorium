/**
 * Campaign service (M2.8 thin slice): create, invite by code, join, submit and approve
 * characters, share homebrew sources. Membership and the DM role are checked here; the content
 * repository and the character service read campaign facts through the repository.
 */
import { createHash, randomBytes } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { schema, type Db } from '../../db/client.js'
import type { Scope } from '../../core/policy.js'
import type { CharacterRepo } from '../characters/repo.js'
import type { CampaignRepo, MemberRole } from './repo.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateCode(): string {
  const bytes = randomBytes(16)
  let code = ''
  for (let i = 0; i < 16; i += 1) code += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length]
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}`
}

export function hashJoinCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

export function createCampaignService(deps: {
  db: Db
  repo: CampaignRepo
  characters: CharacterRepo
}) {
  const { repo } = deps

  async function roleOf(scope: Scope, campaignId: string): Promise<MemberRole> {
    if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
    const role = await repo.memberRole(campaignId, scope.userId)
    if (role) return role
    if (scope.role === 'admin') return 'dm'
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found.' })
  }

  async function assertDm(scope: Scope, campaignId: string): Promise<void> {
    const role = await roleOf(scope, campaignId)
    if (role !== 'dm')
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the DM can do that.' })
  }

  return {
    roleOf,
    assertDm,

    list(scope: Scope) {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      return repo.listForUser(scope.userId)
    },

    async create(scope: Scope, input: { name: string; description?: string }) {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const [ruleset] = await deps.db
        .select({ id: schema.rulesets.id })
        .from(schema.rulesets)
        .limit(1)
      if (!ruleset) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No ruleset.' })
      const id = await repo.create({
        name: input.name,
        description: input.description ?? '',
        rulesetId: ruleset.id,
        dmUserId: scope.userId,
      })
      return { id }
    },

    async get(scope: Scope, campaignId: string) {
      const role = await roleOf(scope, campaignId)
      const campaign = await repo.get(campaignId)
      if (!campaign) throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found.' })
      const [members, characters, sources, encounters] = await Promise.all([
        repo.members(campaignId),
        repo.characters(campaignId),
        repo.sharedSources(campaignId),
        repo.listEncounters(campaignId),
      ])
      return {
        id: campaign.id,
        name: campaign.name,
        descriptionMd: campaign.descriptionMd,
        rulesetId: campaign.rulesetId,
        dmUserId: campaign.dmUserId,
        status: campaign.status,
        role,
        members,
        // Players see every submitted character's name and status; owners decide what to submit.
        characters,
        sources,
        encounters,
      }
    },

    async createInvite(
      scope: Scope,
      input: { campaignId: string; expiresInHours: number; maxUses: number },
    ) {
      await assertDm(scope, input.campaignId)
      const code = generateCode()
      const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000)
      const id = await repo.createInvite({
        campaignId: input.campaignId,
        codeHash: hashJoinCode(code),
        createdBy: scope.userId!,
        expiresAt,
        maxUses: input.maxUses,
      })
      return { id, code, expiresAt }
    },

    async join(scope: Scope, code: string) {
      if (!scope.userId) throw new TRPCError({ code: 'UNAUTHORIZED' })
      const invite = await repo.reserveInvite(hashJoinCode(code))
      if (!invite)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That invite is not valid any more.' })
      const existing = await repo.memberRole(invite.campaignId, scope.userId)
      if (!existing) await repo.addMember(invite.campaignId, scope.userId, 'player')
      return { campaignId: invite.campaignId, role: existing ?? 'player' }
    },

    async submitCharacter(scope: Scope, input: { campaignId: string; characterId: string }) {
      await roleOf(scope, input.campaignId)
      const row = await deps.characters.getRow(deps.db, input.characterId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found.' })
      if (row.ownerUserId !== scope.userId && scope.role !== 'admin')
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'That character belongs to someone else.',
        })
      await repo.submitCharacter(input.campaignId, input.characterId)
      return { ok: true as const }
    },

    async approveCharacter(scope: Scope, input: { campaignId: string; characterId: string }) {
      await assertDm(scope, input.campaignId)
      const ok = await repo.approveCharacter(input.campaignId, input.characterId, scope.userId!)
      if (!ok)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'That character was not submitted.' })
      return { ok: true as const }
    },

    async shareSource(
      scope: Scope,
      input: { campaignId: string; sourceId: string; enabled: boolean },
    ) {
      await assertDm(scope, input.campaignId)
      const [source] = await deps.db
        .select({ id: schema.contentSources.id, ownerUserId: schema.contentSources.ownerUserId })
        .from(schema.contentSources)
        .where(eq(schema.contentSources.id, input.sourceId))
        .limit(1)
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found.' })
      if (source.ownerUserId !== scope.userId && scope.role !== 'admin')
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only share your own sources.' })
      await repo.shareSource({ ...input, sharedBy: scope.userId! })
      return { ok: true as const }
    },

    /** Whether `scope` is the DM of the campaign this character is approved in. */
    async isDmOfCharacter(scope: Scope, characterId: string): Promise<boolean> {
      if (!scope.userId) return false
      const campaign = await repo.approvedCampaignOf(deps.db, characterId)
      return Boolean(campaign && campaign.dmUserId === scope.userId)
    },
  }
}

export type CampaignService = ReturnType<typeof createCampaignService>
