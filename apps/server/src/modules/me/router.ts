import { isSyntheticEmail } from '../../core/auth.js'
import { toRole } from '../../core/policy.js'
import { procedureFor, router } from '../../core/trpc.js'

export const meRouter = router({
  get: procedureFor('me.read').query(({ ctx }) => {
    const user = ctx.session.user as typeof ctx.session.user & {
      username?: string | null
      role?: unknown
    }
    return {
      id: user.id,
      username: user.username ?? null,
      displayName: user.name,
      email: isSyntheticEmail(user.email) ? null : user.email,
      role: toRole(user.role),
      sessionExpiresAt: ctx.session.session.expiresAt,
    }
  }),
})
