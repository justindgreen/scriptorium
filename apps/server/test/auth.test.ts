import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { schema } from '../src/db/client.js'
import {
  ADMIN,
  createTestApp,
  setupAdmin,
  signIn,
  signOut,
  signUp,
  trpcMutation,
  trpcQuery,
  type TestApp,
} from './helpers/app.js'

type Me = {
  id: string
  username: string | null
  displayName: string
  role: 'admin' | 'user'
  email: string | null
}
type Status = { setupComplete: boolean; instanceName: string }
type Invite = { id: string; code: string; url: string }

describe('setup, sign-in, sessions and invites', () => {
  let t: TestApp
  let adminCookie = ''
  let adminId = ''

  beforeAll(async () => {
    t = await createTestApp()
  })

  afterAll(async () => {
    await t.close()
  })

  it('reports setup as incomplete on a fresh instance', async () => {
    const status = await trpcQuery<Status>(t.app, 'system.status')
    expect(status.data).toMatchObject({ setupComplete: false, instanceName: 'Scriptorium' })
  })

  it('refuses protected procedures before anyone exists', async () => {
    const me = await trpcQuery<Me>(t.app, 'me.get')
    expect(me.status).toBe(401)
    expect(me.error?.code).toBe('UNAUTHORIZED')
  })

  it('rejects a weak password during setup', async () => {
    const result = await trpcMutation(t.app, 'setup.createAdmin', {
      instanceName: 'X',
      displayName: 'X',
      username: 'shortpw',
      password: 'short',
    })
    expect(result.status).toBe(400)
    expect(result.error?.code).toBe('BAD_REQUEST')
  })

  it('creates the first administrator, names the instance and signs them in', async () => {
    const setup = await setupAdmin(t.app)
    adminCookie = setup.cookie
    adminId = setup.userId
    expect(adminCookie).toMatch(/scriptorium\.session_token=/)

    const status = await trpcQuery<Status>(t.app, 'system.status')
    expect(status.data).toMatchObject({ setupComplete: true, instanceName: 'Test Table' })

    const me = await trpcQuery<Me>(t.app, 'me.get', undefined, adminCookie)
    expect(me.data).toMatchObject({
      username: ADMIN.username,
      displayName: ADMIN.displayName,
      role: 'admin',
      email: null,
    })
  })

  it('refuses to run setup twice', async () => {
    const again = await trpcMutation(t.app, 'setup.createAdmin', {
      instanceName: 'Y',
      ...ADMIN,
      username: 'another',
    })
    expect(again.status).toBe(409)
    expect(again.error?.code).toBe('CONFLICT')
  })

  it('rejects a wrong password and accepts the right one', async () => {
    const wrong = await signIn(t.app, ADMIN.username, 'definitely-not-the-password')
    expect(wrong.status).toBe(401)
    expect(wrong.cookie).toBe('')

    const right = await signIn(t.app, ADMIN.username, ADMIN.password)
    expect(right.status).toBe(200)
    expect(right.cookie).toMatch(/scriptorium\.session_token=/)
    const me = await trpcQuery<Me>(t.app, 'me.get', undefined, right.cookie)
    expect(me.data?.id).toBe(adminId)
  })

  it('stores sessions in the database and revokes them on sign-out', async () => {
    const session = await signIn(t.app, ADMIN.username, ADMIN.password)
    const rows = await t.tdb.db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, adminId))
    expect(rows.length).toBeGreaterThanOrEqual(2)

    expect(await signOut(t.app, session.cookie)).toBe(200)
    const me = await trpcQuery<Me>(t.app, 'me.get', undefined, session.cookie)
    expect(me.status).toBe(401)
  })

  it('refuses registration without an invite once setup is complete', async () => {
    const result = await signUp(t.app, {
      username: 'sneaky',
      name: 'Sneaky',
      password: 'correct-horse-battery',
    })
    expect(result.status).toBe(403)
    expect(result.body['code']).toBe('INVITE_REQUIRED')
  })

  it('registers a player with a single-use invite and exhausts it', async () => {
    const invite = await trpcMutation<Invite>(
      t.app,
      'admin.invites.create',
      { maxUses: 1 },
      adminCookie,
    )
    expect(invite.data?.code).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/)
    expect(invite.data?.url).toContain(`/register?invite=${invite.data?.code}`)

    const first = await signUp(t.app, {
      username: 'player1',
      name: 'Player One',
      password: 'correct-horse-battery',
      inviteCode: invite.data!.code,
    })
    expect(first.status).toBe(200)
    const me = await trpcQuery<Me>(t.app, 'me.get', undefined, first.cookie)
    expect(me.data).toMatchObject({ username: 'player1', role: 'user' })

    const second = await signUp(t.app, {
      username: 'player2',
      name: 'Player Two',
      password: 'correct-horse-battery',
      inviteCode: invite.data!.code,
    })
    expect(second.status).toBe(403)
  })

  it('refuses revoked and expired invites', async () => {
    const revoked = await trpcMutation<Invite>(t.app, 'admin.invites.create', {}, adminCookie)
    await trpcMutation(t.app, 'admin.invites.revoke', { id: revoked.data!.id }, adminCookie)
    const viaRevoked = await signUp(t.app, {
      username: 'late1',
      name: 'Late',
      password: 'correct-horse-battery',
      inviteCode: revoked.data!.code,
    })
    expect(viaRevoked.status).toBe(403)

    const expired = await trpcMutation<Invite>(
      t.app,
      'admin.invites.create',
      { expiresInHours: 1 },
      adminCookie,
    )
    await t.tdb.db
      .update(schema.invites)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.invites.id, expired.data!.id))
    const viaExpired = await signUp(t.app, {
      username: 'late2',
      name: 'Late',
      password: 'correct-horse-battery',
      inviteCode: expired.data!.code,
    })
    expect(viaExpired.status).toBe(403)
  })

  it('grants the invite role to the registered user', async () => {
    const invite = await trpcMutation<Invite>(
      t.app,
      'admin.invites.create',
      { role: 'admin' },
      adminCookie,
    )
    const result = await signUp(t.app, {
      username: 'codm',
      name: 'Co-DM',
      password: 'correct-horse-battery',
      inviteCode: invite.data!.code,
    })
    expect(result.status).toBe(200)
    const me = await trpcQuery<Me>(t.app, 'me.get', undefined, result.cookie)
    expect(me.data?.role).toBe('admin')
  })

  it('lists invites with their status', async () => {
    await trpcMutation(
      t.app,
      'admin.invites.create',
      { maxUses: 5, note: 'open table' },
      adminCookie,
    )
    const list = await trpcQuery<Array<{ status: string }>>(
      t.app,
      'admin.invites.list',
      undefined,
      adminCookie,
    )
    const statuses = list.data!.map((i) => i.status).sort()
    expect(statuses).toEqual(expect.arrayContaining(['active', 'exhausted', 'expired', 'revoked']))
  })

  it('keeps sessions valid across an application restart', async () => {
    const session = await signIn(t.app, ADMIN.username, ADMIN.password)
    const restarted = await createTestApp(t.tdb)
    try {
      const me = await trpcQuery<Me>(restarted.app, 'me.get', undefined, session.cookie)
      expect(me.data?.id).toBe(adminId)
    } finally {
      await restarted.close()
    }
  })

  it('serves readiness and the OpenAPI face', async () => {
    const ready = await t.app.inject({ method: 'GET', url: '/readyz' })
    expect(ready.json()).toEqual({ status: 'ok', checks: { database: 'ok' } })

    const rest = await t.app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(rest.statusCode).toBe(200)
    expect(rest.json()).toMatchObject({ status: 'ok' })

    const doc = await t.app.inject({ method: 'GET', url: '/api/v1/openapi.json' })
    expect(doc.json<{ openapi: string; paths: Record<string, unknown> }>().paths).toHaveProperty(
      '/health',
    )
  })
})
