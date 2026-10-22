import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ComputedSheet, CharacterAggregate } from '@scriptorium/rules-engine'
import { defaultContentDir, seedBundledContent } from '../src/modules/content/seed.js'
import {
  createTestApp,
  setupAdmin,
  signUp,
  trpcMutation,
  trpcQuery,
  type TestApp,
} from './helpers/app.js'

/**
 * M2.8: campaigns (invite, join, submit, approve, share), DM permissions on party sheets, and
 * the encounter coordinator (initiative, turns issuing `turnStarted`, attacks with single-use
 * rolls and receipts, packets against monster defenses, role-filtered views).
 */
type View = { id: string; revision: number; aggregate: CharacterAggregate; sheet: ComputedSheet }
type Participant = {
  id: string
  kind: 'monster' | 'character'
  displayName: string
  initiative: number | null
  hpCurrent: number | null
  hpMax: number | null
  conditions: Array<{ uid: string }>
  combat: { turn?: { turnId: string; ownTurn: boolean } }
  defeated: boolean
}
type Encounter = {
  id: string
  status: string
  round: number
  turnIndex: number
  currentParticipantId: string | null
  version: number
  role: 'dm' | 'player'
  participants: Participant[]
  actions: Record<string, Array<{ action: unknown; label: string }>>
  events: Array<{ type: string; payload: Record<string, unknown>; actionId: string | null }>
}
type Commit = {
  version: number
  replayed: boolean
  summary: string
  hit: boolean | null
  damageTaken: number
  targetHp: { current: number } | null
}

let t: TestApp
let dm: { userId: string; cookie: string }
let player: { userId: string; cookie: string }
let stranger: string
let campaignId: string
let characterId: string
let encounterId: string
let version = 0

async function invite(adminCookie: string) {
  const created = await trpcMutation<{ code: string }>(
    t.app,
    'admin.invites.create',
    { role: 'user', note: 'test' },
    adminCookie,
  )
  return created.data!.code
}

async function encounter(cookie = dm.cookie) {
  const res = await trpcQuery<Encounter>(t.app, 'encounters.get', { encounterId }, cookie)
  return res.data!
}

beforeAll(async () => {
  t = await createTestApp()
  await seedBundledContent(t.tdb.db, { contentDir: defaultContentDir() })
  // The DM is an ordinary user, so DM permissions (not the administrator's) are what is tested.
  const admin = await setupAdmin(t.app)
  const dungeon = await signUp(t.app, {
    username: 'dungeon',
    name: 'Dungeon',
    password: 'another-horse-battery',
    inviteCode: await invite(admin.cookie),
  })
  dm = { userId: '', cookie: dungeon.cookie }
  const pip = await signUp(t.app, {
    username: 'pip',
    name: 'Pip',
    password: 'another-horse-battery',
    inviteCode: await invite(admin.cookie),
  })
  player = {
    userId: pip.body['user'] ? (pip.body['user'] as { id: string }).id : '',
    cookie: pip.cookie,
  }
  stranger = (
    await signUp(t.app, {
      username: 'stranger',
      name: 'Stranger',
      password: 'another-horse-battery',
      inviteCode: await invite(admin.cookie),
    })
  ).cookie
}, 120_000)

afterAll(async () => {
  await t.close()
})

describe('campaigns', () => {
  it('creates a campaign and lets a player join through an invite code', async () => {
    const created = await trpcMutation<{ id: string }>(
      t.app,
      'campaigns.create',
      { name: 'Thursday Table' },
      dm.cookie,
    )
    expect(created.status).toBe(200)
    campaignId = created.data!.id
    const code = await trpcMutation<{ code: string }>(
      t.app,
      'campaigns.invites.create',
      { campaignId },
      dm.cookie,
    )
    expect(code.data!.code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/)
    const joined = await trpcMutation<{ campaignId: string; role: string }>(
      t.app,
      'campaigns.join',
      { code: code.data!.code },
      player.cookie,
    )
    expect(joined.data).toEqual({ campaignId, role: 'player' })
    const bad = await trpcMutation(
      t.app,
      'campaigns.join',
      { code: 'AAAA-BBBB-CCCC-DDDD' },
      stranger,
    )
    expect(bad.error?.code).toBe('NOT_FOUND')
    const mine = await trpcQuery<Array<{ id: string; role: string }>>(
      t.app,
      'campaigns.list',
      undefined,
      player.cookie,
    )
    expect(mine.data!.map((c) => [c.id, c.role])).toEqual([[campaignId, 'player']])
    const hidden = await trpcQuery(t.app, 'campaigns.get', { campaignId }, stranger)
    expect(hidden.error?.code).toBe('NOT_FOUND')
  })

  it('submits and approves a character; the DM may then read it and issue table commands', async () => {
    const created = await trpcMutation<View>(
      t.app,
      'characters.create',
      {
        name: 'Pip the Bold',
        speciesUid: 'srd-5.1:species:human',
        backgroundUid: 'srd-5.1:background:acolyte',
        classUid: 'srd-5.1:class:fighter',
        baseAbilities: { str: 15, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
        abilityMethod: 'manual',
      },
      player.cookie,
    )
    characterId = created.data!.id
    const armed = await trpcMutation<{ revision: number }>(
      t.app,
      'characters.command',
      {
        characterId,
        commandId: randomUUID(),
        expectedRevision: 0,
        command: {
          type: 'addItem',
          itemId: 'sword',
          itemUid: 'srd-5.1:item:longsword',
          equipped: true,
        },
      },
      player.cookie,
    )
    expect(armed.status).toBe(200)

    const before = await trpcQuery(t.app, 'characters.get', { characterId }, dm.cookie)
    expect(before.error?.code).toBe('FORBIDDEN')
    await trpcMutation(
      t.app,
      'campaigns.characters.submit',
      { campaignId, characterId },
      player.cookie,
    )
    const notYet = await trpcQuery(t.app, 'characters.get', { characterId }, dm.cookie)
    expect(notYet.error?.code).toBe('FORBIDDEN')
    const playerCannotApprove = await trpcMutation(
      t.app,
      'campaigns.characters.approve',
      { campaignId, characterId },
      player.cookie,
    )
    expect(playerCannotApprove.error?.code).toBe('FORBIDDEN')
    const approved = await trpcMutation(
      t.app,
      'campaigns.characters.approve',
      { campaignId, characterId },
      dm.cookie,
    )
    expect(approved.status).toBe(200)
    const view = await trpcQuery<View>(t.app, 'characters.get', { characterId }, dm.cookie)
    expect(view.status).toBe(200)
    const party = await trpcQuery<{
      characters: Array<{ characterId: string; status: string; ownerName: string }>
    }>(t.app, 'campaigns.get', { campaignId }, dm.cookie)
    expect(party.data!.characters).toEqual([
      expect.objectContaining({ characterId, status: 'approved', ownerName: 'Pip' }),
    ])

    // DM table commands on a party character: healing yes, renaming no; strangers nothing.
    const heal = await trpcMutation<{ revision: number }>(
      t.app,
      'characters.command',
      {
        characterId,
        commandId: randomUUID(),
        expectedRevision: view.data!.revision,
        command: { type: 'heal', amount: 1 },
      },
      dm.cookie,
    )
    expect(heal.status).toBe(200)
    const rename = await trpcMutation(
      t.app,
      'characters.command',
      {
        characterId,
        commandId: randomUUID(),
        expectedRevision: heal.data!.revision,
        command: { type: 'setName', name: 'Nope' },
      },
      dm.cookie,
    )
    expect(rename.error?.code).toBe('FORBIDDEN')
    const strangerHeal = await trpcMutation(
      t.app,
      'characters.command',
      {
        characterId,
        commandId: randomUUID(),
        expectedRevision: heal.data!.revision,
        command: { type: 'heal', amount: 1 },
      },
      stranger,
    )
    expect(strangerHeal.error?.code).toBe('FORBIDDEN')
  })

  it('shares a homebrew source with the campaign so a player can see its items', async () => {
    const source = await trpcMutation<{ id: string; slug: string }>(
      t.app,
      'homebrew.sources.create',
      { name: 'Table Forge' },
      dm.cookie,
    )
    const item = await trpcMutation<{ entryId: string; uid: string }>(
      t.app,
      'homebrew.items.create',
      {
        sourceId: source.data!.id,
        draft: {
          name: 'Lantern of Vigil',
          data: {
            category: 'wondrous',
            description: 'Glows.',
            magic: true,
            requiresAttunement: false,
            charges: { max: 3, recharge: { time: 'dawn' } },
          },
          effects: [{ type: 'bonus', target: 'initiative.bonus', value: 1 }],
        },
      },
      dm.cookie,
    )
    await trpcMutation(t.app, 'homebrew.items.publish', { entryId: item.data!.entryId }, dm.cookie)
    const hidden = await trpcQuery(
      t.app,
      'content.entries.get',
      { uid: item.data!.uid },
      player.cookie,
    )
    expect(hidden.error?.code).toBe('NOT_FOUND')
    const shared = await trpcMutation(
      t.app,
      'campaigns.sources.share',
      { campaignId, sourceId: source.data!.id },
      dm.cookie,
    )
    expect(shared.status).toBe(200)
    const visible = await trpcQuery<{ uid: string }>(
      t.app,
      'content.entries.get',
      { uid: item.data!.uid },
      player.cookie,
    )
    expect(visible.data!.uid).toBe(item.data!.uid)
    const stillHidden = await trpcQuery(
      t.app,
      'content.entries.get',
      { uid: item.data!.uid },
      stranger,
    )
    expect(stillHidden.error?.code).toBe('NOT_FOUND')
    // The DM grants the item to the party character.
    const view = await trpcQuery<View>(t.app, 'characters.get', { characterId }, dm.cookie)
    const given = await trpcMutation<{ sheet: ComputedSheet }>(
      t.app,
      'characters.command',
      {
        characterId,
        commandId: randomUUID(),
        expectedRevision: view.data!.revision,
        command: { type: 'addItem', itemId: 'lantern', itemUid: item.data!.uid, equipped: true },
      },
      dm.cookie,
    )
    expect(given.status).toBe(200)
    expect(given.data!.sheet.items.find((i) => i.itemId === 'lantern')).toMatchObject({
      name: 'Lantern of Vigil',
      charges: { current: 3, max: 3 },
    })
  })
})

describe('encounters', () => {
  it('builds the encounter with the party and alpha monsters and rolls initiative', async () => {
    const created = await trpcMutation<{ id: string }>(
      t.app,
      'encounters.create',
      { campaignId, name: 'Crypt' },
      dm.cookie,
    )
    encounterId = created.data!.id
    const playerCannot = await trpcMutation(
      t.app,
      'encounters.addMonster',
      { encounterId, uid: 'srd-5.1:monster:skeleton' },
      player.cookie,
    )
    expect(playerCannot.error?.code).toBe('FORBIDDEN')
    await trpcMutation(t.app, 'encounters.addCharacter', { encounterId, characterId }, dm.cookie)
    const skeletons = await trpcMutation<{ participantIds: string[] }>(
      t.app,
      'encounters.addMonster',
      { encounterId, uid: 'srd-5.1:monster:skeleton', count: 2 },
      dm.cookie,
    )
    expect(skeletons.data!.participantIds).toHaveLength(2)
    const rolled = await trpcMutation<{ rolled: Array<{ participantId: string; total: number }> }>(
      t.app,
      'encounters.rollInitiative',
      { encounterId },
      dm.cookie,
    )
    expect(rolled.data!.rolled).toHaveLength(3)
    const e = await encounter()
    expect(e.participants.every((p) => p.initiative !== null)).toBe(true)
    expect(e.participants.map((p) => p.displayName).sort()).toEqual([
      'Pip the Bold',
      'Skeleton 1',
      'Skeleton 2',
    ])
    version = e.version
  })

  it('orders deterministically once initiative is set and issues turnStarted to characters', async () => {
    const e = await encounter()
    const fighter = e.participants.find((p) => p.kind === 'character')!
    const sk1 = e.participants.find((p) => p.displayName === 'Skeleton 1')
    const sk2 = e.participants.find((p) => p.displayName === 'Skeleton 2')
    for (const [p, init] of [
      [fighter, 20],
      [sk1!, 10],
      [sk2!, 5],
    ] as const) {
      await trpcMutation(
        t.app,
        'encounters.setInitiative',
        { encounterId, participantId: p.id, initiative: init },
        dm.cookie,
      )
    }
    version = (await encounter()).version
    const stale = await trpcMutation(
      t.app,
      'encounters.start',
      { encounterId, expectedVersion: version - 1 },
      dm.cookie,
    )
    expect(stale.error?.code).toBe('CONFLICT')
    const started = await trpcMutation<{
      version: number
      round: number
      turnIndex: number
      turnId: string
    }>(t.app, 'encounters.start', { encounterId, expectedVersion: version }, dm.cookie)
    expect(started.data).toMatchObject({ round: 1, turnIndex: 0, turnId: `${encounterId}:1:0` })
    version = started.data!.version
    let state = await encounter()
    expect(state.status).toBe('active')
    expect(state.currentParticipantId).toBe(fighter.id)
    expect(state.participants.map((p) => p.displayName)).toEqual([
      'Pip the Bold',
      'Skeleton 1',
      'Skeleton 2',
    ])
    const sheet = await trpcQuery<View>(t.app, 'characters.get', { characterId }, player.cookie)
    expect(sheet.data!.aggregate.state.combat.turn).toMatchObject({
      turnId: `${encounterId}:1:0`,
      ownTurn: true,
    })

    const next = await trpcMutation<{ version: number }>(
      t.app,
      'encounters.nextTurn',
      { encounterId, expectedVersion: version },
      dm.cookie,
    )
    version = next.data!.version
    state = await encounter()
    expect(state.currentParticipantId).toBe(sk1!.id)
    const offTurn = await trpcQuery<View>(t.app, 'characters.get', { characterId }, player.cookie)
    expect(offTurn.data!.aggregate.state.combat.turn).toMatchObject({
      turnId: `${encounterId}:1:1`,
      ownTurn: false,
    })
    expect(state.participants.find((p) => p.id === sk1!.id)!.combat.turn).toMatchObject({
      ownTurn: true,
    })
  })

  it('resolves a character attack through the coordinator: once per roll, once per command id', async () => {
    const state = await encounter()
    const fighter = state.participants.find((p) => p.kind === 'character')!
    const skeleton = state.participants.find((p) => p.displayName === 'Skeleton 1')!
    const options = state.actions[fighter.id]!
    const sword = options.find((o) => o.label.startsWith('Longsword'))!
    expect(sword.label).toContain('+5')
    const plan = await trpcQuery<{
      kind: string
      plan: { attack: { bonus: number }; damage: Array<{ formula: string }> }
      targetAc: number
    }>(
      t.app,
      'encounters.attackPlan',
      { encounterId, attackerId: fighter.id, targetId: skeleton.id, action: sword.action },
      dm.cookie,
    )
    expect(plan.data).toMatchObject({ kind: 'character', targetAc: 13 })
    expect(plan.data!.plan.attack.bonus).toBe(5)

    const rolled = await trpcMutation<{ rollId: string }>(
      t.app,
      'encounters.attackRoll',
      { encounterId, attackerId: fighter.id, targetId: skeleton.id, action: sword.action },
      dm.cookie,
    )
    const playerCannot = await trpcMutation(
      t.app,
      'encounters.commitAttack',
      {
        encounterId,
        commandId: randomUUID(),
        rollId: rolled.data!.rollId,
        expectedVersion: version,
      },
      player.cookie,
    )
    expect(playerCannot.error?.code).toBe('FORBIDDEN')
    const commandId = randomUUID()
    const first = await trpcMutation<Commit>(
      t.app,
      'encounters.commitAttack',
      { encounterId, commandId, rollId: rolled.data!.rollId, expectedVersion: version },
      dm.cookie,
    )
    expect(first.status).toBe(200)
    expect(first.data!.replayed).toBe(false)
    expect(first.data!.version).toBe(version + 1)
    const after = await encounter()
    const hp = after.participants.find((p) => p.id === skeleton.id)!.hpCurrent!
    if (first.data!.hit) {
      expect(first.data!.damageTaken).toBeGreaterThan(0)
      expect(hp).toBe(Math.max(0, skeleton.hpCurrent! - first.data!.damageTaken))
    } else {
      expect(hp).toBe(skeleton.hpCurrent)
    }
    expect(after.events[0]).toMatchObject({ type: 'attack', actionId: commandId })
    const log = await trpcQuery<Array<{ type: string }>>(
      t.app,
      'characters.events',
      { characterId, limit: 3 },
      player.cookie,
    )
    expect(log.data![0]!.type).toBe('applyActionOutcome')

    // A retried command id replays the receipt; nothing changes.
    const retry = await trpcMutation<Commit>(
      t.app,
      'encounters.commitAttack',
      { encounterId, commandId, rollId: rolled.data!.rollId, expectedVersion: version },
      dm.cookie,
    )
    expect(retry.data).toMatchObject({ replayed: true, version: version + 1 })
    expect((await encounter()).participants.find((p) => p.id === skeleton.id)!.hpCurrent).toBe(hp)
    // The same roll under a new command id is refused.
    const reuse = await trpcMutation(
      t.app,
      'encounters.commitAttack',
      {
        encounterId,
        commandId: randomUUID(),
        rollId: rolled.data!.rollId,
        expectedVersion: version + 1,
      },
      dm.cookie,
    )
    expect(reuse.error?.code).toBe('PRECONDITION_FAILED')
    version = version + 1
  })

  it('resolves a monster attack against the character with packets on the sheet', async () => {
    const state = await encounter()
    const fighter = state.participants.find((p) => p.kind === 'character')!
    const skeleton = state.participants.find((p) => p.displayName === 'Skeleton 1')!
    const shortsword = state.actions[skeleton.id]!.find((o) => o.label.startsWith('Shortsword'))!
    const before = await trpcQuery<View>(t.app, 'characters.get', { characterId }, player.cookie)
    const rolled = await trpcMutation<{
      rollId: string
      plan: { kind: string; attackBonus: number; targetAc: number }
    }>(
      t.app,
      'encounters.attackRoll',
      { encounterId, attackerId: skeleton.id, targetId: fighter.id, action: shortsword.action },
      dm.cookie,
    )
    expect(rolled.data!.plan).toMatchObject({ kind: 'monster', attackBonus: 4 })
    const commit = await trpcMutation<Commit>(
      t.app,
      'encounters.commitAttack',
      {
        encounterId,
        commandId: randomUUID(),
        rollId: rolled.data!.rollId,
        expectedVersion: version,
      },
      dm.cookie,
    )
    expect(commit.status).toBe(200)
    version = commit.data!.version
    const after = await trpcQuery<View>(t.app, 'characters.get', { characterId }, player.cookie)
    if (commit.data!.hit) {
      expect(after.data!.sheet.hp.current).toBe(
        Math.max(0, before.data!.sheet.hp.current - commit.data!.damageTaken),
      )
      expect(after.data!.revision).toBe(before.data!.revision + 1)
    } else {
      expect(after.data!.sheet.hp.current).toBe(before.data!.sheet.hp.current)
    }
  })

  it('applies vulnerability through monster defenses', async () => {
    // A mace does bludgeoning damage; skeletons are vulnerable to it, so damage taken doubles.
    const view = await trpcQuery<View>(t.app, 'characters.get', { characterId }, player.cookie)
    await trpcMutation(
      t.app,
      'characters.command',
      {
        characterId,
        commandId: randomUUID(),
        expectedRevision: view.data!.revision,
        command: { type: 'addItem', itemId: 'mace', itemUid: 'srd-5.1:item:mace', equipped: true },
      },
      player.cookie,
    )
    const state = await encounter()
    const fighter = state.participants.find((p) => p.kind === 'character')!
    const skeleton = state.participants.find((p) => p.displayName === 'Skeleton 2')!
    const mace = state.actions[fighter.id]!.find((o) => o.label.startsWith('Mace'))!
    let hit = false
    for (let attempt = 0; attempt < 12 && !hit; attempt += 1) {
      const rolled = await trpcMutation<{
        rollId: string
        results: { attack: { natural: number; total: number }; damage: Record<string, number> }
      }>(
        t.app,
        'encounters.attackRoll',
        { encounterId, attackerId: fighter.id, targetId: skeleton.id, action: mace.action },
        dm.cookie,
      )
      const current = (await encounter()).participants.find((p) => p.id === skeleton.id)!
      const commit = await trpcMutation<Commit>(
        t.app,
        'encounters.commitAttack',
        {
          encounterId,
          commandId: randomUUID(),
          rollId: rolled.data!.rollId,
          expectedVersion: version,
        },
        dm.cookie,
      )
      version = commit.data!.version
      if (commit.data!.hit) {
        hit = true
        const rolledDamage = Object.values(rolled.data!.results.damage).reduce((a, b) => a + b, 0)
        expect(commit.data!.damageTaken).toBe(rolledDamage * 2)
        expect(commit.data!.targetHp!.current).toBe(
          Math.max(0, current.hpCurrent! - rolledDamage * 2),
        )
      }
    }
    expect(hit).toBe(true)
  })

  it('tracks conditions, hand-adjusted monster hit points, defeated skipping and the player view', async () => {
    const state = await encounter()
    const fighter = state.participants.find((p) => p.kind === 'character')!
    const skeleton = state.participants.find((p) => p.displayName === 'Skeleton 2')!
    await trpcMutation(
      t.app,
      'encounters.setCondition',
      { encounterId, participantId: skeleton.id, uid: 'srd-5.1:condition:prone', active: true },
      dm.cookie,
    )
    await trpcMutation(
      t.app,
      'encounters.setCondition',
      { encounterId, participantId: fighter.id, uid: 'srd-5.1:condition:blinded', active: true },
      dm.cookie,
    )
    const withConditions = await encounter()
    expect(withConditions.participants.find((p) => p.id === skeleton.id)!.conditions).toEqual([
      { uid: 'srd-5.1:condition:prone' },
    ])
    const sheet = await trpcQuery<View>(t.app, 'characters.get', { characterId }, player.cookie)
    expect(sheet.data!.aggregate.state.conditions.map((c) => c.uid)).toContain(
      'srd-5.1:condition:blinded',
    )
    const down = await trpcMutation<{ hpCurrent: number }>(
      t.app,
      'encounters.adjustHp',
      { encounterId, participantId: skeleton.id, delta: -100 },
      dm.cookie,
    )
    expect(down.data!.hpCurrent).toBe(0)
    version = (await encounter()).version
    // Turn order: fighter (20), skeleton 1 (10), skeleton 2 (5, defeated → skipped).
    const toFighter = await trpcMutation<{ round: number; turnIndex: number }>(
      t.app,
      'encounters.nextTurn',
      { encounterId, expectedVersion: version },
      dm.cookie,
    )
    expect(toFighter.status).toBe(200)
    let e = await encounter()
    version = e.version
    const current = e.participants.find((p) => p.id === e.currentParticipantId)!
    expect(current.defeated).toBe(false)
    const asPlayer = await encounter(player.cookie)
    expect(asPlayer.role).toBe('player')
    expect(
      asPlayer.participants
        .filter((p) => p.kind === 'monster')
        .every((p) => p.hpCurrent === null && p.hpMax === null),
    ).toBe(true)
    expect(asPlayer.participants.find((p) => p.kind === 'character')!.displayName).toBe(
      'Pip the Bold',
    )
    expect(asPlayer.actions).toEqual({})
    const ended = await trpcMutation<{ version: number }>(
      t.app,
      'encounters.end',
      { encounterId, expectedVersion: version },
      dm.cookie,
    )
    expect(ended.status).toBe(200)
    e = await encounter()
    expect(e.status).toBe('completed')
  })
})
