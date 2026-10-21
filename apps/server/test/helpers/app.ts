import type { LightMyRequestResponse } from 'fastify'
import { buildApp, type App } from '../../src/app.js'
import { syntheticEmail } from '../../src/core/auth.js'
import { loadConfig } from '../../src/core/config.js'
import { createTestDatabase, type TestDatabase } from './database.js'

export type TestApp = { app: App; tdb: TestDatabase; close: () => Promise<void> }

export const TEST_SECRET = 'test-secret-'.padEnd(48, 'x')

/** Builds a full application instance on a fresh migrated database. */
export async function createTestApp(existing?: TestDatabase): Promise<TestApp> {
  const tdb = existing ?? (await createTestDatabase())
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: tdb.url,
    APP_SECRET: TEST_SECRET,
    PUBLIC_URL: 'http://localhost:3000',
  })
  const app = await buildApp({
    config,
    database: { db: tdb.db, pool: tdb.pool },
    secret: TEST_SECRET,
  })
  await app.ready()
  return {
    app,
    tdb,
    close: async () => {
      await app.close()
      if (!existing) await tdb.drop()
    },
  }
}

export type TrpcResult<T> = {
  status: number
  data?: T
  error?: { code: string; message: string }
}

function parseTrpc<T>(res: LightMyRequestResponse): TrpcResult<T> {
  const body = res.json<{
    result?: { data: T }
    error?: { message: string; data?: { code: string } }
  }>()
  if (body.error) {
    return {
      status: res.statusCode,
      error: { code: body.error.data?.code ?? 'UNKNOWN', message: body.error.message },
    }
  }
  return { status: res.statusCode, data: body.result?.data as T }
}

export async function trpcQuery<T>(app: App, path: string, input?: unknown, cookie?: string) {
  const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  const res = await app.inject({
    method: 'GET',
    url: `/api/trpc/${path}${query}`,
    headers: cookie ? { cookie } : {},
  })
  return parseTrpc<T>(res)
}

export async function trpcMutation<T>(app: App, path: string, input?: unknown, cookie?: string) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/trpc/${path}`,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    payload: JSON.stringify(input ?? null),
  })
  return { ...parseTrpc<T>(res), cookie: cookieFrom(res) }
}

/** Joins every Set-Cookie into a Cookie header value. */
export function cookieFrom(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  return list
    .map((c) => c.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ')
}

export async function signIn(app: App, username: string, password: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    headers: { 'content-type': 'application/json' },
    payload: { username, password },
  })
  return {
    status: res.statusCode,
    cookie: cookieFrom(res),
    body: res.json<Record<string, unknown>>(),
  }
}

export async function signUp(
  app: App,
  input: { username: string; name: string; password: string; inviteCode?: string; email?: string },
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { 'content-type': 'application/json' },
    payload: {
      email: input.email ?? syntheticEmail(input.username),
      password: input.password,
      name: input.name,
      username: input.username,
      ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
    },
  })
  return {
    status: res.statusCode,
    cookie: cookieFrom(res),
    body: res.json<Record<string, unknown>>(),
  }
}

export async function signOut(app: App, cookie: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-out',
    headers: { 'content-type': 'application/json', cookie },
    payload: {},
  })
  return res.statusCode
}

export const ADMIN = {
  username: 'gamemaster',
  displayName: 'Game Master',
  password: 'correct-horse-battery',
}

/** Completes the setup wizard and returns the signed-in administrator's cookie. */
export async function setupAdmin(app: App) {
  const result = await trpcMutation<{ userId: string }>(app, 'setup.createAdmin', {
    instanceName: 'Test Table',
    ...ADMIN,
  })
  if (!result.data) throw new Error(`setup failed: ${JSON.stringify(result.error)}`)
  return { userId: result.data.userId, cookie: result.cookie }
}
