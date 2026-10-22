import { initTRPC, TRPCError } from '@trpc/server'
import type { CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import type { Pool } from 'pg'
import type { OpenApiMeta } from 'trpc-to-openapi'
import type { Db } from '../db/client.js'
import type { InviteService } from '../modules/admin/invites.js'
import type { CharacterService } from '../modules/characters/service.js'
import type { RollService } from '../modules/characters/rolls.js'
import type { ContentRepo } from '../modules/content/repo.js'
import type { EventBus } from './events.js'
import type { Audit } from './audit.js'
import type { Auth, SessionInfo } from './auth.js'
import type { Config } from './config.js'
import type { MaintenanceGate } from './maintenance.js'
import { anonymousScope, assertCan, toRole, type Action, type Scope } from './policy.js'
import type { Settings } from './settings.js'

export type Services = {
  config: Config
  db: Db
  pool: Pool
  auth: Auth
  audit: Audit
  invites: InviteService
  settings: Settings
  content: ContentRepo
  characters: CharacterService
  rolls: RollService
  events: EventBus
  databaseUrl: string
  maintenance: MaintenanceGate
}

export type Context = Services & {
  session: SessionInfo | null
  scope: Scope
  /** Incoming request headers as a WHATWG Headers object (what Better Auth's API expects). */
  headers: Headers
  ip: string
  /** Forwards Set-Cookie headers produced by Better Auth to the HTTP response. */
  setCookies: (cookies: string[]) => void
}

/** Converts Fastify's raw headers into a Headers object, pinning the client IP for rate limiting. */
export function toWebHeaders(
  raw: Record<string, string | string[] | undefined>,
  ip: string,
): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  // Fastify already resolved the client address (honouring TRUST_PROXY); never trust the raw header.
  headers.set('x-forwarded-for', ip)
  return headers
}

export function createContextFactory(services: Services) {
  return async ({ req, res }: CreateFastifyContextOptions): Promise<Context> => {
    const headers = toWebHeaders(req.headers, req.ip)
    const session = await services.auth.api.getSession({ headers })
    const scope: Scope = session
      ? { userId: session.user.id, role: toRole((session.user as { role?: unknown }).role) }
      : anonymousScope
    return {
      ...services,
      session,
      scope,
      headers,
      ip: req.ip,
      setCookies: (cookies) => {
        if (cookies.length > 0) void res.header('set-cookie', cookies)
      },
    }
  }
}

const t = initTRPC
  .meta<OpenApiMeta>()
  .context<Context>()
  .create({
    // Subscriptions stream as Server-Sent Events; pings keep proxies from closing idle streams
    // and the client reconnects (then refetches on a revision gap) after a quiet minute.
    sse: {
      ping: { enabled: true, intervalMs: 25_000 },
      client: { reconnectAfterInactivityMs: 60_000 },
    },
  })

export const router = t.router
export const mergeRouters = t.mergeRouters
export const publicProcedure = t.procedure

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' })
  }
  return next({ ctx: { ...ctx, session: ctx.session } })
})

/** A procedure that requires the named policy action. Every protected procedure uses this. */
export function procedureFor(action: Action) {
  return authedProcedure.use(({ ctx, next }) => {
    assertCan(ctx.scope, action)
    return next()
  })
}
