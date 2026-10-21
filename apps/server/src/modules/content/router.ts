import { TRPCError } from '@trpc/server'
import { contentKindSchema } from '@scriptorium/content-schema'
import { z } from 'zod'
import { procedureFor, publicProcedure, router } from '../../core/trpc.js'
import { ImportError, importPackage } from './import.js'

export const contentRouter = router({
  /** Public: licence and attribution for every installed source (shown before sign-in too). */
  licenses: publicProcedure.query(async ({ ctx }) => {
    const sources = await ctx.content.listSources()
    return sources.map((s) => ({
      slug: s.slug,
      name: s.name,
      kind: s.kind,
      license: s.license,
      attributionText: s.attributionText,
      version: s.version,
      publisher: s.publisher,
      url: s.url,
      entryCount: s.entryCount,
      isEnabled: s.isEnabled,
    }))
  }),

  rulesets: procedureFor('content.read').query(({ ctx }) => ctx.content.listRulesets()),

  sources: router({
    list: procedureFor('content.read').query(({ ctx }) => ctx.content.listSources()),
    setEnabled: procedureFor('admin.content.manage')
      .input(z.object({ id: z.string().uuid(), enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const ok = await ctx.content.setSourceEnabled(input.id, input.enabled)
        if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'Source not found.' })
        await ctx.audit.record({
          actorId: ctx.scope.userId,
          action: input.enabled ? 'admin.source.enabled' : 'admin.source.disabled',
          targetType: 'content_source',
          targetId: input.id,
          ip: ctx.ip,
        })
        return { ok: true as const }
      }),
    countsByKind: procedureFor('content.read')
      .input(z.object({ sourceSlug: z.string().optional() }).optional())
      .query(({ ctx, input }) => ctx.content.countByKind(input?.sourceSlug)),
  }),

  entries: router({
    list: procedureFor('content.read')
      .input(
        z.object({
          kind: contentKindSchema.optional(),
          sourceSlugs: z.array(z.string()).max(50).optional(),
          q: z.string().trim().max(120).optional(),
          tags: z.array(z.string()).max(20).optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(({ ctx, input }) =>
        ctx.content.listEntries({
          ...(input.kind ? { kind: input.kind } : {}),
          ...(input.sourceSlugs ? { sourceSlugs: input.sourceSlugs } : {}),
          ...(input.q ? { q: input.q } : {}),
          ...(input.tags ? { tags: input.tags } : {}),
          limit: input.limit,
          offset: input.offset,
        }),
      ),
    get: procedureFor('content.read')
      .input(z.object({ uid: z.string().min(3).max(200) }))
      .query(async ({ ctx, input }) => {
        const entry = await ctx.content.getEntry(input.uid)
        if (!entry) throw new TRPCError({ code: 'NOT_FOUND', message: 'Content not found.' })
        return entry
      }),
  }),

  /** Administrators import portable packages (homebrew or licensed content they own). */
  importPackage: procedureFor('admin.content.manage')
    .input(z.object({ package: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await importPackage(ctx.db, input.package, { actorId: ctx.scope.userId })
        await ctx.audit.record({
          actorId: ctx.scope.userId,
          action: 'admin.content.imported',
          targetType: 'content_source',
          targetId: result.source.id,
          metadata: { slug: result.source.slug, ...result.entries },
          ip: ctx.ip,
        })
        return result
      } catch (error) {
        if (error instanceof ImportError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message, cause: error.issues })
        }
        throw error
      }
    }),
})
