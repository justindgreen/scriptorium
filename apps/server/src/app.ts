import { existsSync } from 'node:fs'
import path from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { Config } from './core/config.js'
import { APP_VERSION } from './core/version.js'

export type App = FastifyInstance

const startedAt = Date.now()

/**
 * Builds the Fastify application. Pure with respect to process state so tests can build
 * many instances; `main.ts` is the only place that listens on a port.
 */
export async function buildApp(config: Config): Promise<App> {
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
    trustProxy: false,
  })

  /** Liveness: the process is up. */
  app.get('/healthz', async () => ({
    status: 'ok' as const,
    version: APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }))

  /** Readiness: dependencies are reachable. The database check is added in M1.3. */
  app.get('/readyz', async () => ({
    status: 'ok' as const,
    checks: { database: 'not configured' as const },
  }))

  app.get('/api', async () => ({ name: 'scriptorium', version: APP_VERSION }))

  if (config.WEB_DIST_DIR) {
    const root = path.resolve(config.WEB_DIST_DIR)
    if (!existsSync(path.join(root, 'index.html'))) {
      throw new Error(`WEB_DIST_DIR does not contain a built web app: ${root}`)
    }
    await app.register(fastifyStatic, { root, prefix: '/', wildcard: false })
    // Single-page app fallback: unknown GET paths outside the API render the app shell.
    app.setNotFoundHandler(async (request, reply) => {
      const isApi =
        request.url.startsWith('/api') ||
        request.url.startsWith('/healthz') ||
        request.url.startsWith('/readyz')
      if (request.method === 'GET' && !isApi) {
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ error: 'Not found' })
    })
  }

  return app
}
