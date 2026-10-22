import { z } from 'zod'
import { procedureFor, router } from '../../core/trpc.js'
import {
  createItemSchema,
  createSourceSchema,
  entryIdSchema,
  previewSchema,
  saveItemSchema,
} from './schemas.js'

export const homebrewRouter = router({
  sources: router({
    list: procedureFor('homebrew.read').query(({ ctx }) => ctx.homebrew.listSources(ctx.scope)),
    create: procedureFor('homebrew.write')
      .input(createSourceSchema)
      .mutation(({ ctx, input }) => ctx.homebrew.createSource(ctx.scope, input)),
  }),

  items: router({
    list: procedureFor('homebrew.read').query(({ ctx }) => ctx.homebrew.listItems(ctx.scope)),

    get: procedureFor('homebrew.read')
      .input(entryIdSchema)
      .query(({ ctx, input }) => ctx.homebrew.getItem(ctx.scope, input.entryId)),

    /** Loose input on purpose: the editor wants every issue as a path, not an input error. */
    validate: procedureFor('homebrew.read')
      .input(z.unknown())
      .query(({ ctx, input }) => ctx.homebrew.validate(input)),

    create: procedureFor('homebrew.write')
      .input(createItemSchema)
      .mutation(({ ctx, input }) => ctx.homebrew.createItem(ctx.scope, input)),

    save: procedureFor('homebrew.write')
      .input(saveItemSchema)
      .mutation(({ ctx, input }) => ctx.homebrew.saveItem(ctx.scope, input)),

    publish: procedureFor('homebrew.write')
      .input(entryIdSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.homebrew.publishItem(ctx.scope, input.entryId)
        await ctx.audit.record({
          actorId: ctx.scope.userId,
          action: 'homebrew.published',
          targetType: 'content_entry',
          targetId: input.entryId,
          metadata: { uid: result.uid, versionNo: result.versionNo },
          ip: ctx.ip,
        })
        return result
      }),

    delete: procedureFor('homebrew.write')
      .input(entryIdSchema)
      .mutation(({ ctx, input }) => ctx.homebrew.deleteItem(ctx.scope, input.entryId)),

    preview: procedureFor('homebrew.read')
      .input(previewSchema)
      .query(({ ctx, input }) => ctx.homebrew.preview(ctx.scope, input)),
  }),
})
