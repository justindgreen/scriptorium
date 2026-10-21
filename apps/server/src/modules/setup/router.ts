import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { syntheticEmail } from '../../core/auth.js'
import { publicProcedure, router } from '../../core/trpc.js'
import { withAdvisoryLock } from '../../db/locks.js'

export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_.-]+$/, 'Letters, digits, dot, underscore and dash only')

export const passwordSchema = z.string().min(10).max(256)

const SETUP_LOCK_KEY = 75_31_0001

export const setupRouter = router({
  /**
   * Creates the first administrator account and names the instance. Allowed only while no users
   * exist; an advisory lock makes two simultaneous attempts impossible. Signs the new admin in.
   */
  createAdmin: publicProcedure
    .input(
      z.object({
        instanceName: z.string().trim().min(1).max(80),
        displayName: z.string().trim().min(1).max(80),
        username: usernameSchema,
        password: passwordSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withAdvisoryLock(ctx.pool, SETUP_LOCK_KEY, async () => {
        if (await ctx.settings.isSetupComplete()) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Setup is already complete.' })
        }
        const { headers, response } = await ctx.auth.api.signUpEmail({
          body: {
            name: input.displayName,
            email: syntheticEmail(input.username),
            password: input.password,
            username: input.username,
          },
          headers: ctx.headers,
          returnHeaders: true,
        })
        await ctx.settings.set('instance_name', input.instanceName)
        await ctx.audit.record({
          actorId: response.user.id,
          action: 'setup.completed',
          targetType: 'instance',
          metadata: { instanceName: input.instanceName },
          ip: ctx.ip,
        })
        ctx.setCookies(headers.getSetCookie())
        return { userId: response.user.id }
      })
    }),
})
