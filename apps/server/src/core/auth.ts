import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin, username } from 'better-auth/plugins'
import type { Db } from '../db/client.js'
import { schema } from '../db/client.js'
import type { InviteService } from '../modules/admin/invites.js'
import type { Audit } from './audit.js'
import type { Config } from './config.js'
import { newId } from './ids.js'
import type { Settings } from './settings.js'

export type AuthDeps = {
  db: Db
  config: Config
  secret: string
  audit: Audit
  invites: InviteService
  settings: Settings
}

/** Synthetic address for accounts without an email; Better Auth requires one, we never send mail. */
export function syntheticEmail(usernameValue: string): string {
  return `${usernameValue.toLowerCase()}@scriptorium.local`
}

export function isSyntheticEmail(email: string): boolean {
  return email.endsWith('@scriptorium.local')
}

/** Paths of Better Auth endpoints that create users without an invite (the admin already authorised them). */
const ADMIN_CREATE_PATHS = new Set(['/admin/create-user'])

/**
 * Better Auth instance (ADR-0024): Drizzle adapter on our tables, username + admin plugins,
 * DB-backed cookie sessions, invite-gated registration, built-in rate limiting.
 */
export function createAuth(deps: AuthDeps) {
  const { db, config, audit, invites, settings } = deps

  return betterAuth({
    appName: 'Scriptorium',
    baseURL: config.PUBLIC_URL,
    basePath: '/api/auth',
    secret: deps.secret,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      autoSignIn: true,
      requireEmailVerification: false,
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
        // Same rule as usernameSchema: letters, digits, dot, underscore, dash.
        usernameValidator: (value) => /^[A-Za-z0-9_.-]+$/.test(value),
      }),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: config.NODE_ENV !== 'test',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/username': { window: 60, max: 8 },
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 300, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: 'scriptorium',
      useSecureCookies: config.cookieSecure,
      database: { generateId: () => newId() },
    },
    databaseHooks: {
      user: {
        create: {
          /**
           * Registration policy: the first account ever created becomes the administrator (setup);
           * afterwards a valid invite is required unless an administrator creates the account.
           */
          before: async (userData, ctx) => {
            if (!(await settings.isSetupComplete())) {
              return { data: { ...userData, role: 'admin' } }
            }
            if (ctx && ADMIN_CREATE_PATHS.has(ctx.path)) {
              return { data: userData }
            }
            const body = (ctx?.body ?? {}) as { inviteCode?: unknown }
            const code = typeof body.inviteCode === 'string' ? body.inviteCode : ''
            const reserved = code ? await invites.reserve(code) : null
            if (!reserved) {
              throw new APIError('FORBIDDEN', {
                message: 'A valid invite code is required to register.',
                code: 'INVITE_REQUIRED',
              })
            }
            return { data: { ...userData, role: reserved.role } }
          },
          after: async (created, ctx) => {
            await audit.record({
              actorId: created.id,
              action: 'user.registered',
              targetType: 'user',
              targetId: created.id,
              metadata: {
                username: (created as { username?: string }).username ?? null,
                path: ctx?.path ?? null,
              },
              ip: ipFromContext(ctx),
            })
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/username' || ctx.path === '/sign-in/email') {
          const session = ctx.context.newSession
          if (session) {
            await audit.record({
              actorId: session.user.id,
              action: 'auth.sign_in',
              targetType: 'user',
              targetId: session.user.id,
              ip: ipFromContext(ctx),
            })
          }
        }
        if (ctx.path === '/sign-out') {
          const current = ctx.context.session
          if (current) {
            await audit.record({
              actorId: current.user.id,
              action: 'auth.sign_out',
              targetType: 'user',
              targetId: current.user.id,
              ip: ipFromContext(ctx),
            })
          }
        }
      }),
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
export type SessionInfo = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

function ipFromContext(ctx: { headers?: Headers | null } | null | undefined): string | null {
  return ctx?.headers?.get('x-forwarded-for') ?? null
}
