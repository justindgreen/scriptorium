import { procedureFor, router } from '../../core/trpc.js'
import {
  campaignCharacterSchema,
  campaignIdSchema,
  createCampaignSchema,
  createInviteSchema,
  joinSchema,
  shareSourceSchema,
} from './schemas.js'

export const campaignsRouter = router({
  list: procedureFor('campaign.read').query(({ ctx }) => ctx.campaigns.list(ctx.scope)),

  create: procedureFor('campaign.create')
    .input(createCampaignSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.campaigns.create(ctx.scope, input)
      await ctx.audit.record({
        actorId: ctx.scope.userId,
        action: 'campaign.created',
        targetType: 'campaign',
        targetId: created.id,
        ip: ctx.ip,
      })
      return created
    }),

  get: procedureFor('campaign.read')
    .input(campaignIdSchema)
    .query(({ ctx, input }) => ctx.campaigns.get(ctx.scope, input.campaignId)),

  invites: router({
    create: procedureFor('campaign.write')
      .input(createInviteSchema)
      .mutation(({ ctx, input }) => ctx.campaigns.createInvite(ctx.scope, input)),
  }),

  join: procedureFor('campaign.write')
    .input(joinSchema)
    .mutation(({ ctx, input }) => ctx.campaigns.join(ctx.scope, input.code)),

  characters: router({
    submit: procedureFor('campaign.write')
      .input(campaignCharacterSchema)
      .mutation(({ ctx, input }) => ctx.campaigns.submitCharacter(ctx.scope, input)),
    approve: procedureFor('campaign.write')
      .input(campaignCharacterSchema)
      .mutation(({ ctx, input }) => ctx.campaigns.approveCharacter(ctx.scope, input)),
  }),

  sources: router({
    share: procedureFor('campaign.write')
      .input(shareSourceSchema)
      .mutation(({ ctx, input }) => ctx.campaigns.shareSource(ctx.scope, input)),
  }),
})
