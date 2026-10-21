import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ADMIN,
  createTestApp,
  setupAdmin,
  signIn,
  signUp,
  trpcMutation,
  trpcQuery,
  type TestApp,
} from './helpers/app.js'

type Me = { id: string; role: 'admin' | 'user' }
type UserRow = { id: string; username: string | null; role: string; banned: boolean }
type AuditRow = { action: string; actorUsername: string | null; targetId: string | null }

describe('administration', () => {
  let t: TestApp
  let adminCookie = ''
  let adminId = ''
  let playerCookie = ''
  let playerId = ''

  beforeAll(async () => {
    t = await createTestApp()
    const setup = await setupAdmin(t.app)
    adminCookie = setup.cookie
    adminId = setup.userId
    const invite = await trpcMutation<{ code: string }>(
      t.app,
      'admin.invites.create',
      {},
      adminCookie,
    )
    const player = await signUp(t.app, {
      username: 'player1',
      name: 'Player One',
      password: 'correct-horse-battery',
      inviteCode: invite.data!.code,
    })
    playerCookie = player.cookie
    playerId = (await trpcQuery<Me>(t.app, 'me.get', undefined, playerCookie)).data!.id
  })

  afterAll(async () => {
    await t.close()
  })

  it('forbids players from every admin procedure', async () => {
    for (const path of [
      'admin.users.list',
      'admin.invites.list',
      'admin.audit.list',
      'admin.settings.get',
    ]) {
      const result = await trpcQuery(t.app, path, undefined, playerCookie)
      expect(result.status, path).toBe(403)
      expect(result.error?.code, path).toBe('FORBIDDEN')
    }
    const create = await trpcMutation(t.app, 'admin.invites.create', {}, playerCookie)
    expect(create.error?.code).toBe('FORBIDDEN')
    const anonymous = await trpcQuery(t.app, 'admin.users.list')
    expect(anonymous.error?.code).toBe('UNAUTHORIZED')
  })

  it('lists users for administrators', async () => {
    const list = await trpcQuery<UserRow[]>(t.app, 'admin.users.list', undefined, adminCookie)
    expect(list.data?.map((u) => u.username).sort()).toEqual([ADMIN.username, 'player1'])
  })

  it('never removes the last active administrator', async () => {
    const demote = await trpcMutation(
      t.app,
      'admin.users.setRole',
      { userId: adminId, role: 'user' },
      adminCookie,
    )
    expect(demote.error?.code).toBe('BAD_REQUEST')
    const banSelf = await trpcMutation(t.app, 'admin.users.ban', { userId: adminId }, adminCookie)
    expect(banSelf.error?.code).toBe('BAD_REQUEST')
  })

  it('promotes and demotes users', async () => {
    const promote = await trpcMutation(
      t.app,
      'admin.users.setRole',
      { userId: playerId, role: 'admin' },
      adminCookie,
    )
    expect(promote.data).toEqual({ ok: true })
    const session = await signIn(t.app, 'player1', 'correct-horse-battery')
    expect((await trpcQuery<Me>(t.app, 'me.get', undefined, session.cookie)).data?.role).toBe(
      'admin',
    )

    const demote = await trpcMutation(
      t.app,
      'admin.users.setRole',
      { userId: playerId, role: 'user' },
      adminCookie,
    )
    expect(demote.data).toEqual({ ok: true })
    const after = await signIn(t.app, 'player1', 'correct-horse-battery')
    expect((await trpcQuery<Me>(t.app, 'me.get', undefined, after.cookie)).data?.role).toBe('user')
  })

  it('deactivates a user, which blocks sign-in and existing sessions, then reactivates them', async () => {
    const before = await signIn(t.app, 'player1', 'correct-horse-battery')
    expect(before.status).toBe(200)

    const ban = await trpcMutation(
      t.app,
      'admin.users.ban',
      { userId: playerId, reason: 'left the table' },
      adminCookie,
    )
    expect(ban.data).toEqual({ ok: true })

    const blocked = await signIn(t.app, 'player1', 'correct-horse-battery')
    expect(blocked.status).toBeGreaterThanOrEqual(400)
    expect((await trpcQuery<Me>(t.app, 'me.get', undefined, before.cookie)).status).toBe(401)

    const list = await trpcQuery<UserRow[]>(t.app, 'admin.users.list', undefined, adminCookie)
    expect(list.data?.find((u) => u.id === playerId)).toMatchObject({ banned: true })

    const unban = await trpcMutation(t.app, 'admin.users.unban', { userId: playerId }, adminCookie)
    expect(unban.data).toEqual({ ok: true })
    const again = await signIn(t.app, 'player1', 'correct-horse-battery')
    expect(again.status).toBe(200)
  })

  it('reads and updates instance settings', async () => {
    expect((await trpcQuery(t.app, 'admin.settings.get', undefined, adminCookie)).data).toEqual({
      instanceName: 'Test Table',
    })
    await trpcMutation(
      t.app,
      'admin.settings.set',
      { instanceName: 'Thursday Night Table' },
      adminCookie,
    )
    const status = await trpcQuery<{ instanceName: string }>(t.app, 'system.status')
    expect(status.data?.instanceName).toBe('Thursday Night Table')
  })

  it('records administrative and security actions in the audit log', async () => {
    const audit = await trpcQuery<AuditRow[]>(
      t.app,
      'admin.audit.list',
      { limit: 200 },
      adminCookie,
    )
    const actions = new Set(audit.data!.map((a) => a.action))
    for (const expected of [
      'setup.completed',
      'admin.invite.created',
      'user.registered',
      'auth.sign_in',
      'admin.user.set_role',
      'admin.user.deactivated',
      'admin.user.reactivated',
      'admin.settings.updated',
    ]) {
      expect(actions, expected).toContain(expected)
    }
    const setRole = audit.data!.find((a) => a.action === 'admin.user.set_role')
    expect(setRole).toMatchObject({ actorUsername: ADMIN.username, targetId: playerId })
  })
})
