import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig, ConfigError } from '../src/core/config.js'
import { createTestApp, type TestApp } from './helpers/app.js'

describe('server foundation', () => {
  let t: TestApp

  beforeAll(async () => {
    t = await createTestApp()
  })

  afterAll(async () => {
    await t.close()
  })

  it('reports liveness on /healthz', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ status: string; version: string; uptimeSeconds: number }>()
    expect(body.status).toBe('ok')
    expect(typeof body.version).toBe('string')
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })

  it('returns 404 JSON for unknown API routes when no web app is served', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })
})

describe('configuration', () => {
  it('applies defaults', () => {
    const config = loadConfig({})
    expect(config.PORT).toBe(3000)
    expect(config.NODE_ENV).toBe('development')
    expect(config.DATA_DIR).toBe('./.data')
    expect(config.cookieSecure).toBe(false)
    expect(config.trustedOrigins).toContain('http://localhost:5173')
  })

  it('rejects invalid values with a readable error', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(ConfigError)
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
  })

  it('requires DATABASE_URL and APP_SECRET in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL[\s\S]*APP_SECRET/)
    const ok = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://u:p@db:5432/s',
      APP_SECRET: 'x'.repeat(40),
      PUBLIC_URL: 'https://dnd.example.com',
    })
    expect(ok.cookieSecure).toBe(true)
    expect(ok.trustedOrigins).toEqual(['https://dnd.example.com'])
  })
})
