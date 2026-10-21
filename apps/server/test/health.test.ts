import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp, type App } from '../src/app.js'
import { loadConfig, ConfigError } from '../src/core/config.js'

describe('server foundation', () => {
  let app: App

  beforeAll(async () => {
    app = await buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }))
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('reports liveness on /healthz', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ status: string; version: string; uptimeSeconds: number }>()
    expect(body.status).toBe('ok')
    expect(typeof body.version).toBe('string')
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })

  it('reports readiness on /readyz', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ status: string }>().status).toBe('ok')
  })

  it('returns 404 JSON for unknown API routes when no web app is served', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(res.statusCode).toBe(404)
  })
})

describe('configuration', () => {
  it('applies defaults', () => {
    const config = loadConfig({})
    expect(config.PORT).toBe(3000)
    expect(config.NODE_ENV).toBe('development')
    expect(config.DATA_DIR).toBe('./.data')
  })

  it('rejects invalid values with a readable error', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError)
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
  })
})
