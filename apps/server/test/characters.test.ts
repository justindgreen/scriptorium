import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CharacterAggregate, ComputedSheet } from '@scriptorium/rules-engine'
import { defaultContentDir, seedBundledContent } from '../src/modules/content/seed.js'
import {
  createTestApp,
  setupAdmin,
  signUp,
  trpcMutation,
  trpcQuery,
  type TestApp,
} from './helpers/app.js'

type View = { id: string; revision: number; aggregate: CharacterAggregate; sheet: ComputedSheet }
type CommandResult = {
  revision: number
  eventId: string
  replayed: boolean
  summary: string
  sheet: ComputedSheet
  aggregate: CharacterAggregate
}

const FIGHTER = 'srd-5.1:class:fighter'
const ROGUE = 'srd-5.1:class:rogue'

let t: TestApp
let admin: { userId: string; cookie: string }
let player: string

beforeAll(async () => {
  t = await createTestApp()
  await seedBundledContent(t.tdb.db, { contentDir: defaultContentDir() })
  admin = await setupAdmin(t.app)
  const invite = await trpcMutation<{ code: string }>(
    t.app,
    'admin.invites.create',
    { role: 'user', note: 'test' },
    admin.cookie,
  )
  const signedUp = await signUp(t.app, {
    username: 'rook',
    name: 'Rook',
    password: 'another-horse-battery',
    inviteCode: invite.data!.code,
  })
  player = signedUp.cookie
}, 120_000)

afterAll(async () => {
  await t.close()
})

async function command(
  characterId: string,
  expectedRevision: number,
  body: unknown,
  cookie = player,
  commandId = randomUUID(),
) {
  return trpcMutation<CommandResult>(
    t.app,
    'characters.command',
    { characterId, commandId, expectedRevision, command: body },
    cookie,
  )
}

describe('characters: creation and the command path', () => {
  let id: string
  let revision = 0

  it('creates a level-1 fighter with a computed sheet', async () => {
    const created = await trpcMutation<View>(
      t.app,
      'characters.create',
      {
        name: 'Bram',
        speciesUid: 'srd-5.1:species:human',
        backgroundUid: 'srd-5.1:background:acolyte',
        classUid: FIGHTER,
        baseAbilities: { str: 15, dex: 13, con: 13, int: 8, wis: 11, cha: 9 },
      },
      player,
    )
    expect(created.status).toBe(200)
    id = created.data!.id
    expect(created.data!.revision).toBe(0)
    expect(created.data!.sheet.level).toBe(1)
    expect(created.data!.sheet.stats['ability.str.score']?.value).toBe(16) // human +1
    expect(created.data!.sheet.hp.max).toBe(12)
    expect(created.data!.aggregate.state.hpCurrent).toBe(12)
    expect(created.data!.sheet.pendingChoices.map((p) => p.key)).toEqual(
      expect.arrayContaining([`class:${FIGHTER}@1/skills`]),
    )
    const list = await trpcQuery<Array<{ id: string; name: string; summary: { level: number } }>>(
      t.app,
      'characters.list',
      undefined,
      player,
    )
    expect(list.data?.map((c) => c.name)).toEqual(['Bram'])
    expect(list.data?.[0]?.summary.level).toBe(1)
  })

  it('applies a command, bumps the revision and logs the event', async () => {
    const result = await command(id, revision, {
      type: 'setChoice',
      key: `class:${FIGHTER}@1/skills`,
      selection: { kind: 'skill', skills: ['athletics', 'perception'] },
    })
    expect(result.status).toBe(200)
    expect(result.data!.revision).toBe(1)
    expect(result.data!.replayed).toBe(false)
    expect(result.data!.sheet.stats['skill.athletics.proficiency']?.value).toBe(1)
    revision = result.data!.revision
    const events = await trpcQuery<
      Array<{ type: string; revisionAfter: number; reversible: boolean; summary: string }>
    >(t.app, 'characters.events', { characterId: id }, player)
    expect(events.data?.[0]).toMatchObject({
      type: 'setChoice',
      revisionAfter: 1,
      reversible: false,
    })
  })

  it('rejects a stale revision with CONFLICT', async () => {
    const stale = await command(id, 0, { type: 'setInspiration', value: true })
    expect(stale.status).toBe(409)
    expect(stale.error?.code).toBe('CONFLICT')
  })

  it('replays a repeated command id instead of applying it twice', async () => {
    const commandId = randomUUID()
    const first = await command(
      id,
      revision,
      { type: 'adjustCurrency', delta: { gp: 10 } },
      player,
      commandId,
    )
    expect(first.data!.revision).toBe(revision + 1)
    const again = await command(
      id,
      revision,
      { type: 'adjustCurrency', delta: { gp: 10 } },
      player,
      commandId,
    )
    expect(again.status).toBe(200)
    expect(again.data!.revision).toBe(revision + 1)
    expect(again.data!.replayed).toBe(true)
    expect(again.data!.aggregate.state.currency.gp).toBe(10)
    revision = again.data!.revision
  })

  it('undoes the latest reversible event with its recorded before values', async () => {
    const added = await command(id, revision, {
      type: 'addItem',
      itemId: 'sword',
      itemUid: 'srd-5.1:item:longsword',
    })
    revision = added.data!.revision
    const equipped = await command(id, revision, { type: 'equip', itemId: 'sword' })
    revision = equipped.data!.revision
    expect(equipped.data!.sheet.actionTemplates.some((a) => a.name === 'Longsword')).toBe(true)
    const availability = await trpcQuery<{ ok: boolean; eventType?: string }>(
      t.app,
      'characters.undoAvailability',
      { characterId: id },
      player,
    )
    expect(availability.data).toEqual({ ok: true, eventType: 'equip' })
    const undone = await trpcMutation<CommandResult>(
      t.app,
      'characters.undo',
      { characterId: id, expectedRevision: revision },
      player,
    )
    expect(undone.status).toBe(200)
    expect(undone.data!.aggregate.inventory.find((i) => i.id === 'sword')?.equipped).toBe(false)
    revision = undone.data!.revision
    const twice = await trpcQuery<{ ok: boolean; reason?: string }>(
      t.app,
      'characters.undoAvailability',
      { characterId: id },
      player,
    )
    expect(twice.data?.ok).toBe(false)
  })

  it('levels up with snapshots and enforces multiclass prerequisites', async () => {
    for (let level = 2; level <= 5; level += 1) {
      const result = await command(id, revision, {
        type: 'addClassLevel',
        classUid: FIGHTER,
        ...(level === 3 ? { subclassUid: 'srd-5.1:subclass:champion' } : {}),
      })
      expect(result.status, `level ${level}`).toBe(200)
      revision = result.data!.revision
      expect(result.data!.sheet.level).toBe(level)
    }
    const view = await trpcQuery<View>(t.app, 'characters.get', { characterId: id }, player)
    expect(view.data!.sheet.stats['attacks.perAction']?.value).toBe(2)
    expect(view.data!.sheet.stats['crit.range']?.value).toBe(19)
    const snapshots = await trpcQuery<Array<{ reason: string; revision: number }>>(
      t.app,
      'characters.snapshots.list',
      { characterId: id },
      player,
    )
    expect(snapshots.data?.filter((s) => s.reason === 'level_up')).toHaveLength(4)

    const lowDex = await command(id, revision, {
      type: 'setAbilities',
      method: 'manual',
      abilities: { str: 15, dex: 11, con: 13, int: 8, wis: 11, cha: 9 },
    })
    revision = lowDex.data!.revision
    const rogue = await command(id, revision, { type: 'addClassLevel', classUid: ROGUE })
    expect(rogue.status).toBe(400)
    expect(rogue.error?.message).toMatch(/prerequisite/i)
    const okDex = await command(id, revision, {
      type: 'setAbilities',
      method: 'manual',
      abilities: { str: 15, dex: 13, con: 13, int: 8, wis: 11, cha: 9 },
    })
    revision = okDex.data!.revision
    const rogueOk = await command(id, revision, { type: 'addClassLevel', classUid: ROGUE })
    expect(rogueOk.status).toBe(200)
    revision = rogueOk.data!.revision
    expect(rogueOk.data!.sheet.level).toBe(6)
    expect(rogueOk.data!.sheet.classes.map((c) => c.name)).toEqual(['Fighter', 'Rogue'])
  })

  it('restores a snapshot as a logged, non-undoable command', async () => {
    const snapshots = await trpcQuery<Array<{ id: string; revision: number }>>(
      t.app,
      'characters.snapshots.list',
      { characterId: id },
      player,
    )
    const oldest = snapshots.data!.sort((a, b) => a.revision - b.revision)[0]!
    const restored = await trpcMutation<CommandResult>(
      t.app,
      'characters.snapshots.restore',
      { characterId: id, snapshotId: oldest.id, expectedRevision: revision },
      player,
    )
    expect(restored.status).toBe(200)
    expect(restored.data!.sheet.level).toBe(1)
    revision = restored.data!.revision
    const availability = await trpcQuery<{ ok: boolean }>(
      t.app,
      'characters.undoAvailability',
      { characterId: id },
      player,
    )
    expect(availability.data?.ok).toBe(false)
  })

  it('keeps other players out and lets administrators in', async () => {
    const other = await trpcQuery<View>(t.app, 'characters.get', { characterId: id }, admin.cookie)
    expect(other.status).toBe(200)
    const invite = await trpcMutation<{ code: string }>(
      t.app,
      'admin.invites.create',
      { role: 'user', note: 'stranger' },
      admin.cookie,
    )
    const stranger = await signUp(t.app, {
      username: 'stranger',
      name: 'Stranger',
      password: 'yet-another-horse-battery',
      inviteCode: invite.data!.code,
    })
    const denied = await trpcQuery<View>(
      t.app,
      'characters.get',
      { characterId: id },
      stranger.cookie,
    )
    expect(denied.status).toBe(403)
    const deniedWrite = await command(
      id,
      revision,
      { type: 'setInspiration', value: true },
      stranger.cookie,
    )
    expect(deniedWrite.status).toBe(403)
    const anonymous = await trpcQuery<View>(t.app, 'characters.get', { characterId: id })
    expect(anonymous.status).toBe(401)
  })

  it('soft-deletes', async () => {
    const deleted = await trpcMutation<{ ok: true }>(
      t.app,
      'characters.delete',
      { characterId: id },
      player,
    )
    expect(deleted.status).toBe(200)
    const gone = await trpcQuery<View>(t.app, 'characters.get', { characterId: id }, player)
    expect(gone.status).toBe(404)
  })
})
