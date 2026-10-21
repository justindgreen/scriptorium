import { z } from 'zod'
import { APP_VERSION } from '../../core/version.js'
import { publicProcedure, router } from '../../core/trpc.js'

export const systemRouter = router({
  health: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/health', tags: ['system'], summary: 'Liveness' } })
    .input(z.void())
    .output(z.object({ status: z.literal('ok'), version: z.string() }))
    .query(() => ({ status: 'ok' as const, version: APP_VERSION })),

  /** Public instance status used by the web app to decide between setup, login and home. */
  status: publicProcedure.query(async ({ ctx }) => ({
    setupComplete: await ctx.settings.isSetupComplete(),
    instanceName: await ctx.settings.instanceName(),
    version: APP_VERSION,
  })),
})
