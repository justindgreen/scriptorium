import { TRPCError } from '@trpc/server'
import { and, asc, count, eq } from 'drizzle-orm'
import { z } from 'zod'
import { schema, type Db } from '../../db/client.js'
import { procedureFor, router } from '../../core/trpc.js'

const roleSchema = z.enum(['admin', 'user'])

const usersRouter = router({
  list: procedureFor('admin.users.manage').query(({ ctx }) =>
    ctx.db
      .select({
        id: schema.user.id,
        username: schema.user.username,
        displayName: schema.user.name,
        role: schema.user.role,
        banned: schema.user.banned,
        banReason: schema.user.banReason,
        createdAt: schema.user.createdAt,
      })
      .from(schema.user)
      .orderBy(asc(schema.user.createdAt)),
  ),

  setRole: procedureFor('admin.users.manage')
    .input(z.object({ userId: z.string().min(1), role: roleSchema }))
    .mutation(async ({ ctx, input }) => {
      if (input.role !== 'admin') {
        await assertNotLastAdmin(ctx.db, input.userId)
      }
      await ctx.auth.api.setRole({
        headers: ctx.headers,
        body: { userId: input.userId, role: input.role },
      })
      await ctx.audit.record({
        actorId: ctx.scope.userId,
        action: 'admin.user.set_role',
        targetType: 'user',
        targetId: input.userId,
        metadata: { role: input.role },
        ip: ctx.ip,
      })
      return { ok: true as const }
    }),

  ban: procedureFor('admin.users.manage')
    .input(z.object({ userId: z.string().min(1), reason: z.string().trim().max(200).optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.scope.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You cannot deactivate your own account.',
        })
      }
      await assertNotLastAdmin(ctx.db, input.userId)
      await ctx.auth.api.banUser({
        headers: ctx.headers,
        body: { userId: input.userId, ...(input.reason ? { banReason: input.reason } : {}) },
      })
      await ctx.audit.record({
        actorId: ctx.scope.userId,
        action: 'admin.user.deactivated',
        targetType: 'user',
        targetId: input.userId,
        metadata: { reason: input.reason ?? null },
        ip: ctx.ip,
      })
      return { ok: true as const }
    }),

  unban: procedureFor('admin.users.manage')
    .input(z.object({ userId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.auth.api.unbanUser({ headers: ctx.headers, body: { userId: input.userId } })
      await ctx.audit.record({
        actorId: ctx.scope.userId,
        action: 'admin.user.reactivated',
        targetType: 'user',
        targetId: input.userId,
        ip: ctx.ip,
      })
      return { ok: true as const }
    }),
})

const invitesRouter = router({
  list: procedureFor('admin.invites.manage').query(({ ctx }) => ctx.invites.list()),

  create: procedureFor('admin.invites.manage')
    .input(
      z.object({
        role: roleSchema.default('user'),
        expiresInHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 30)
          .default(24 * 7),
        maxUses: z.number().int().min(1).max(100).default(1),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.invites.create({
        role: input.role,
        expiresInHours: input.expiresInHours,
        maxUses: input.maxUses,
        note: input.note ?? null,
        createdBy: ctx.scope.userId as string,
      })
      await ctx.audit.record({
        actorId: ctx.scope.userId,
        action: 'admin.invite.created',
        targetType: 'invite',
        targetId: created.id,
        metadata: {
          role: input.role,
          maxUses: input.maxUses,
          expiresAt: created.expiresAt.toISOString(),
        },
        ip: ctx.ip,
      })
      const url = new URL('/register', ctx.config.PUBLIC_URL)
      url.searchParams.set('invite', created.code)
      return {
        id: created.id,
        code: created.code,
        url: url.toString(),
        expiresAt: created.expiresAt,
      }
    }),

  revoke: procedureFor('admin.invites.manage')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const revoked = await ctx.invites.revoke(input.id)
      if (!revoked) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invite not found or already revoked.' })
      }
      await ctx.audit.record({
        actorId: ctx.scope.userId,
        action: 'admin.invite.revoked',
        targetType: 'invite',
        targetId: input.id,
        ip: ctx.ip,
      })
      return { ok: true as const }
    }),
})

const auditRouter = router({
  list: procedureFor('admin.audit.read')
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
    .query(({ ctx, input }) => ctx.audit.list(input?.limit ?? 100)),
})

const settingsRouter = router({
  get: procedureFor('admin.settings.manage').query(async ({ ctx }) => ({
    instanceName: await ctx.settings.instanceName(),
  })),

  set: procedureFor('admin.settings.manage')
    .input(z.object({ instanceName: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.settings.set('instance_name', input.instanceName)
      await ctx.audit.record({
        actorId: ctx.scope.userId,
        action: 'admin.settings.updated',
        targetType: 'instance',
        metadata: { instanceName: input.instanceName },
        ip: ctx.ip,
      })
      return { ok: true as const }
    }),
})

export const adminRouter = router({
  users: usersRouter,
  invites: invitesRouter,
  audit: auditRouter,
  settings: settingsRouter,
})

/** Refuses to demote or deactivate the only remaining active administrator. */
async function assertNotLastAdmin(db: Db, userId: string) {
  const [target] = await db
    .select({ role: schema.user.role, banned: schema.user.banned })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
  if (!target) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' })
  }
  if (target.role !== 'admin' || target.banned) return
  const [admins] = await db
    .select({ n: count() })
    .from(schema.user)
    .where(and(eq(schema.user.role, 'admin'), eq(schema.user.banned, false)))
  if ((admins?.n ?? 0) <= 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'There must always be at least one active administrator.',
    })
  }
}
