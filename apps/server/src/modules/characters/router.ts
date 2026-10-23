import { z } from 'zod'
import { procedureFor, router } from '../../core/trpc.js'
import {
  commandRequestSchema,
  commitRollSchema,
  createCharacterSchema,
  hitDieRequestSchema,
  planRequestSchema,
} from './schemas.js'

const byId = z.object({ characterId: z.string().uuid() })

export const charactersRouter = router({
  list: procedureFor('character.read').query(({ ctx }) => ctx.characters.list(ctx.scope)),

  create: procedureFor('character.create')
    .input(createCharacterSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.characters.create(ctx.scope, input)
      await ctx.audit.record({
        actorId: ctx.scope.userId,
        action: 'character.created',
        targetType: 'character',
        targetId: created.id,
        ip: ctx.ip,
      })
      return created
    }),

  get: procedureFor('character.read')
    .input(byId)
    .query(({ ctx, input }) => ctx.characters.get(ctx.scope, input.characterId)),

  command: procedureFor('character.write')
    .input(commandRequestSchema)
    .mutation(({ ctx, input }) => ctx.characters.command(ctx.scope, input)),

  plan: procedureFor('character.read')
    .input(planRequestSchema)
    .query(({ ctx, input }) => ctx.rolls.plan(ctx.scope, input.characterId, input.ref, input.ctx)),

  roll: procedureFor('character.write')
    .input(planRequestSchema)
    .mutation(({ ctx, input }) =>
      ctx.rolls.roll(ctx.scope, input.characterId, input.ref, input.ctx),
    ),

  rollAbilities: procedureFor('character.create').mutation(({ ctx }) =>
    ctx.rolls.rollAbilities(ctx.scope),
  ),

  rollHitDie: procedureFor('character.write')
    .input(hitDieRequestSchema)
    .mutation(({ ctx, input }) => ctx.rolls.rollHitDie(ctx.scope, input.characterId, input.die)),

  subscribe: procedureFor('character.read')
    .input(byId)
    .subscription(({ ctx, input, signal }) =>
      ctx.characters.subscribe(ctx.scope, input.characterId, signal),
    ),

  commitAction: procedureFor('character.write')
    .input(commitRollSchema)
    .mutation(({ ctx, input }) => ctx.rolls.commit(ctx.scope, input)),

  undo: procedureFor('character.write')
    .input(byId.extend({ expectedRevision: z.number().int().min(0) }))
    .mutation(({ ctx, input }) =>
      ctx.characters.undo(ctx.scope, input.characterId, input.expectedRevision),
    ),

  undoAvailability: procedureFor('character.read')
    .input(byId)
    .query(({ ctx, input }) => ctx.characters.undoAvailability(ctx.scope, input.characterId)),

  revertLevelUp: procedureFor('character.write')
    .input(byId.extend({ expectedRevision: z.number().int().min(0) }))
    .mutation(({ ctx, input }) =>
      ctx.characters.revertLevelUp(ctx.scope, input.characterId, input.expectedRevision),
    ),

  events: procedureFor('character.read')
    .input(byId.extend({ limit: z.number().int().min(1).max(200).default(50) }))
    .query(({ ctx, input }) => ctx.characters.events(ctx.scope, input.characterId, input.limit)),

  snapshots: router({
    list: procedureFor('character.read')
      .input(byId)
      .query(({ ctx, input }) => ctx.characters.snapshots(ctx.scope, input.characterId)),
    take: procedureFor('character.write')
      .input(byId)
      .mutation(({ ctx, input }) => ctx.characters.takeSnapshot(ctx.scope, input.characterId)),
    restore: procedureFor('character.write')
      .input(
        byId.extend({ snapshotId: z.string().uuid(), expectedRevision: z.number().int().min(0) }),
      )
      .mutation(({ ctx, input }) =>
        ctx.characters.restoreSnapshot(
          ctx.scope,
          input.characterId,
          input.snapshotId,
          input.expectedRevision,
        ),
      ),
  }),

  delete: procedureFor('character.write')
    .input(byId)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.characters.remove(ctx.scope, input.characterId)
      await ctx.audit.record({
        actorId: ctx.scope.userId,
        action: 'character.deleted',
        targetType: 'character',
        targetId: input.characterId,
        ip: ctx.ip,
      })
      return result
    }),
})
