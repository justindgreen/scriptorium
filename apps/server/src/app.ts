import { existsSync } from 'node:fs'
import path from 'node:path'
import fastifyStatic from '@fastify/static'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { sql } from 'drizzle-orm'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { fastifyTRPCOpenApiPlugin, generateOpenApiDocument } from 'trpc-to-openapi'
import { createAudit } from './core/audit.js'
import { createAuth, type Auth } from './core/auth.js'
import type { Config } from './core/config.js'
import { createSettings } from './core/settings.js'
import { createContextFactory, type Services } from './core/trpc.js'
import { APP_VERSION } from './core/version.js'
import type { Db } from './db/client.js'
import { createInviteService } from './modules/admin/invites.js'
import { appRouter, type AppRouter } from './router.js'

export type App = FastifyInstance & { services: Services }

export type AppDeps = {
  config: Config
  database: { db: Db; pool: Pool }
  secret: string
}

const startedAt = Date.now()

/**
 * Builds the Fastify application: health endpoints, Better Auth routes, the tRPC API, the
 * OpenAPI face of selected procedures, and static hosting of the web app. `main.ts` is the only
 * place that connects the database and listens on a port, so tests can build many instances.
 */
export async function buildApp(deps: AppDeps): Promise<App> {
  const { config } = deps
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      ...(config.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss' },
            },
          }
        : {}),
    },
    trustProxy: config.TRUST_PROXY,
  }) as unknown as App

  const db = deps.database.db
  const audit = createAudit(db)
  const settings = createSettings(db)
  const invites = createInviteService(db)
  const auth = createAuth({ db, config, secret: deps.secret, audit, invites, settings })
  const services: Services = {
    config,
    db,
    pool: deps.database.pool,
    auth,
    audit,
    invites,
    settings,
  }
  app.decorate('services', services)

  app.get('/healthz', async () => ({
    status: 'ok' as const,
    version: APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }))

  app.get('/readyz', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`)
      return { status: 'ok' as const, checks: { database: 'ok' as const } }
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed')
      return reply.code(503).send({ status: 'unavailable', checks: { database: 'error' } })
    }
  })

  registerAuthRoutes(app, auth)

  const createContext = createContextFactory(services)
  await app.register(fastifyTRPCPlugin<AppRouter>, {
    prefix: '/api/trpc',
    trpcOptions: {
      router: appRouter,
      createContext,
      onError: ({ error, path }) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          app.log.error({ err: error, path }, 'tRPC internal error')
        }
      },
    },
  })

  await app.register(fastifyTRPCOpenApiPlugin, {
    basePath: '/api/v1',
    router: appRouter,
    createContext,
  })
  const openApiDocument = generateOpenApiDocument(appRouter, {
    title: 'Scriptorium API',
    version: APP_VERSION,
    baseUrl: new URL('/api/v1', config.PUBLIC_URL).toString(),
    description: 'Public REST face of selected procedures (health, import/export).',
  })
  app.get('/api/v1/openapi.json', async () => openApiDocument)

  app.get('/api', async () => ({ name: 'scriptorium', version: APP_VERSION }))

  if (config.WEB_DIST_DIR) {
    const root = path.resolve(config.WEB_DIST_DIR)
    if (!existsSync(path.join(root, 'index.html'))) {
      throw new Error(`WEB_DIST_DIR does not contain a built web app: ${root}`)
    }
    await app.register(fastifyStatic, { root, prefix: '/', wildcard: false })
  }

  // Unknown GET paths outside the API render the app shell (single-page app routing).
  app.setNotFoundHandler(async (request, reply) => {
    const isApi =
      request.url.startsWith('/api') ||
      request.url.startsWith('/healthz') ||
      request.url.startsWith('/readyz')
    if (request.method === 'GET' && !isApi && config.WEB_DIST_DIR) {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send({ error: 'Not found' })
  })

  return app
}

/** Mounts Better Auth's handler under /api/auth/* by translating Fastify requests to fetch Requests. */
function registerAuthRoutes(app: FastifyInstance, auth: Auth) {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const url = new URL(
        request.url,
        `${request.protocol}://${request.headers.host ?? 'localhost'}`,
      )
      const headers = new Headers()
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) continue
        headers.set(key, Array.isArray(value) ? value.join(', ') : value)
      }
      headers.set('x-forwarded-for', request.ip)
      const hasBody =
        request.method !== 'GET' && request.body !== undefined && request.body !== null
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers,
          ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
        }),
      )
      reply.status(response.status)
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') void reply.header(key, value)
      })
      const cookies = response.headers.getSetCookie()
      if (cookies.length > 0) void reply.header('set-cookie', cookies)
      return reply.send(response.body ? await response.text() : null)
    },
  })
}
