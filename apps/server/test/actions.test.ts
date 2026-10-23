import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ActionPlan, CharacterAggregate, ComputedSheet } from '@scriptorium/rules-engine'
import { defaultContentDir, seedBundledContent } from '../src/modules/content/seed.js'
import { createTestApp, setupAdmin, trpcMutation, trpcQuery, type TestApp } from './helpers/app.js'

/**
 * M2.6: the explicit roll step (plan → roll → commit) with single-use rolls, hit die rolls, and
 * live updates over the tRPC subscription (docs/ARCHITECTURE.md §6–§7).
 */
type View = { id: string; revision: number; aggregate: CharacterAggregate; sheet: ComputedSheet }
type Stored = {
  id: string
  plan: ActionPlan
  results: { attack?: { natural: number; total: number }; damage?: Record<string, number> }
}
type Committed = {
  revision: number
  replayed: boolean
  outcome: { attack?: { hit: boolean | null } }
}

let t: TestApp
let admin: { userId: string; cookie: string }
let id: string
let revision = 0

beforeAll(async () => {
  t = await createTestApp()
  await seedBundledContent(t.tdb.db, { contentDir: defaultContentDir() })
  admin = await setupAdmin(t.app)
  const created = await trpcMutation<View>(
    t.app,
    'characters.create',
    {
      name: 'Sable',
      speciesUid: 'srd-5.1:species:human',
      backgroundUid: 'srd-5.1:background:acolyte',
      classUid: 'srd-5.1:class:fighter',
      baseAbilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 8 },
      abilityMethod: 'manual',
    },
    admin.cookie,
  )
  id = created.data!.id
  const added = await trpcMutation<{ revision: number }>(
    t.app,
    'characters.command',
    {
      characterId: id,
      commandId: randomUUID(),
      expectedRevision: 0,
      command: {
        type: 'addItem',
        itemId: 'sword',
        itemUid: 'srd-5.1:item:longsword',
        equipped: true,
      },
    },
    admin.cookie,
  )
  revision = added.data!.revision
}, 120_000)

afterAll(async () => {
  await t.close()
})

const weapon = { kind: 'weapon', itemId: 'sword' } as const

describe('the roll step', () => {
  it('plans a weapon attack without rolling or spending anything', async () => {
    const plan = await trpcQuery<ActionPlan>(
      t.app,
      'characters.plan',
      { characterId: id, ref: weapon, ctx: { situation: { advantageSources: ['prone target'] } } },
      admin.cookie,
    )
    expect(plan.status).toBe(200)
    expect(plan.data!.attack).toMatchObject({ mode: 'advantage', bonus: 5 })
    expect(plan.data!.damage[0]!.formula).toBe('1d8 + 3')
    const view = await trpcQuery<View>(t.app, 'characters.get', { characterId: id }, admin.cookie)
    expect(view.data!.revision).toBe(revision)
  })

  it('rolls on the server and stores the roll', async () => {
    const rolled = await trpcMutation<Stored>(
      t.app,
      'characters.roll',
      { characterId: id, ref: weapon, ctx: {} },
      admin.cookie,
    )
    expect(rolled.status).toBe(200)
    const { results } = rolled.data!
    expect(results.attack!.natural).toBeGreaterThanOrEqual(1)
    expect(results.attack!.natural).toBeLessThanOrEqual(20)
    expect(results.attack!.total).toBe(results.attack!.natural + 5)
    const packet = rolled.data!.plan.damage[0]!
    expect(results.damage![packet.id]).toBeGreaterThanOrEqual(4)
  })

  it('applies a stored roll exactly once', async () => {
    const rolled = await trpcMutation<Stored>(
      t.app,
      'characters.roll',
      { characterId: id, ref: weapon, ctx: {} },
      admin.cookie,
    )
    const commandId = randomUUID()
    const first = await trpcMutation<Committed>(
      t.app,
      'characters.commitAction',
      {
        characterId: id,
        commandId,
        expectedRevision: revision,
        rollId: rolled.data!.id,
        targetAc: 1,
      },
      admin.cookie,
    )
    expect(first.status).toBe(200)
    // Against AC 1 everything hits except a natural 1, which always misses.
    expect(first.data!.outcome.attack!.hit).toBe(rolled.data!.results.attack!.natural !== 1)
    expect(first.data!.revision).toBe(revision + 1)
    revision = first.data!.revision

    // The same command id replays the receipt instead of applying again.
    const replay = await trpcMutation<Committed>(
      t.app,
      'characters.commitAction',
      {
        characterId: id,
        commandId,
        expectedRevision: revision - 1,
        rollId: rolled.data!.id,
        targetAc: 1,
      },
      admin.cookie,
    )
    expect(replay.data!.replayed).toBe(true)
    expect(replay.data!.revision).toBe(revision)

    // A new command with the consumed roll is refused and changes nothing.
    const again = await trpcMutation<Committed>(
      t.app,
      'characters.commitAction',
      {
        characterId: id,
        commandId: randomUUID(),
        expectedRevision: revision,
        rollId: rolled.data!.id,
      },
      admin.cookie,
    )
    expect(again.error?.code).toBe('PRECONDITION_FAILED')
    const view = await trpcQuery<View>(t.app, 'characters.get', { characterId: id }, admin.cookie)
    expect(view.data!.revision).toBe(revision)
    const events = await trpcQuery<Array<{ type: string }>>(
      t.app,
      'characters.events',
      { characterId: id, limit: 5 },
      admin.cookie,
    )
    expect(events.data![0]!.type).toBe('applyActionOutcome')
  })

  it('rolls hit dice within the die and records them', async () => {
    const rolled = await trpcMutation<{ roll: number; breakdown: string }>(
      t.app,
      'characters.rollHitDie',
      { characterId: id, die: 'd10' },
      admin.cookie,
    )
    expect(rolled.status).toBe(200)
    expect(rolled.data!.roll).toBeGreaterThanOrEqual(1)
    expect(rolled.data!.roll).toBeLessThanOrEqual(10)
    const rest = await trpcMutation<{ revision: number; summary: string }>(
      t.app,
      'characters.command',
      {
        characterId: id,
        commandId: randomUUID(),
        expectedRevision: revision,
        command: { type: 'shortRest', hitDice: [{ die: 'd10', roll: rolled.data!.roll }] },
      },
      admin.cookie,
    )
    expect(rest.status).toBe(200)
    revision = rest.data!.revision
    expect(rest.data!.summary).toMatch(/Short rest/)
  })
})

describe('casting spells (D-1)', () => {
  const CLERIC = 'srd-5.1:class:cleric'
  const SACRED_FLAME = 'srd-5.1:spell:sacred-flame'
  const GUIDING_BOLT = 'srd-5.1:spell:guiding-bolt'
  let cleric: string
  let rev = 0

  async function cmd(command: unknown, commandId = randomUUID()) {
    const res = await trpcMutation<{
      revision: number
      replayed: boolean
      aggregate: CharacterAggregate
      sheet: ComputedSheet
    }>(
      t.app,
      'characters.command',
      { characterId: cleric, commandId, expectedRevision: rev, command },
      admin.cookie,
    )
    if (res.status === 200 && !res.data!.replayed) rev = res.data!.revision
    return res
  }

  it('gives a cleric a damage cantrip and a prepared attack spell', async () => {
    const created = await trpcMutation<{ id: string; sheet: ComputedSheet }>(
      t.app,
      'characters.create',
      {
        name: 'Vesper',
        speciesUid: 'srd-5.1:species:human',
        backgroundUid: 'srd-5.1:background:acolyte',
        classUid: CLERIC,
        abilityMethod: 'manual',
        baseAbilities: { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 8 },
      },
      admin.cookie,
    )
    expect(created.status).toBe(200)
    cleric = created.data!.id
    const prepared = await cmd({
      type: 'setSpells',
      spells: [
        {
          spellUid: SACRED_FLAME,
          origin: `class:${CLERIC}`,
          known: true,
          prepared: false,
          alwaysPrepared: false,
        },
        {
          spellUid: GUIDING_BOLT,
          origin: `class:${CLERIC}`,
          known: true,
          prepared: true,
          alwaysPrepared: false,
        },
      ],
    })
    expect(prepared.status).toBe(200)
    const known = prepared.data!.sheet.spellcasting!.known.map((k) => k.spellUid)
    expect(known).toEqual(expect.arrayContaining([SACRED_FLAME, GUIDING_BOLT]))
  })

  it('plans a saving-throw cantrip with typed damage and no slot cost, and commits it once', async () => {
    const plan = await trpcQuery<ActionPlan>(
      t.app,
      'characters.plan',
      { characterId: cleric, ref: { kind: 'spell', spellUid: SACRED_FLAME } },
      admin.cookie,
    )
    expect(plan.status).toBe(200)
    expect(plan.data!.save).toEqual({ ability: 'dex', dc: 13, onSuccess: 'none' })
    expect(plan.data!.attack).toBeUndefined()
    expect(plan.data!.damage.map((d) => [d.id, d.formula, d.damageType])).toEqual([
      ['spell', '1d8', 'radiant'],
    ])
    expect(plan.data!.costs).toEqual([])
    const rolled = await trpcMutation<{ id: string; results: { damage: Record<string, number> } }>(
      t.app,
      'characters.roll',
      { characterId: cleric, ref: { kind: 'spell', spellUid: SACRED_FLAME } },
      admin.cookie,
    )
    expect(rolled.status).toBe(200)
    expect(rolled.data!.results.damage['spell']).toBeGreaterThanOrEqual(1)
    const commandId = randomUUID()
    const committed = await trpcMutation<{
      revision: number
      outcome: { packets: Array<{ amount: number }> }
      aggregate: CharacterAggregate
    }>(
      t.app,
      'characters.commitAction',
      { characterId: cleric, commandId, expectedRevision: rev, rollId: rolled.data!.id },
      admin.cookie,
    )
    expect(committed.status).toBe(200)
    rev = committed.data!.revision
    expect(committed.data!.outcome.packets).toHaveLength(1)
    expect(committed.data!.aggregate.state.spellSlotsUsed).toEqual({})
  })

  it('upcasts an attack spell, spends the slot exactly once across a retry, and scales the dice', async () => {
    const at1 = await trpcQuery<ActionPlan>(
      t.app,
      'characters.plan',
      { characterId: cleric, ref: { kind: 'spell', spellUid: GUIDING_BOLT, slotLevel: 1 } },
      admin.cookie,
    )
    expect(at1.data!.attack?.attackType).toBe('spell')
    expect(at1.data!.attack?.bonus).toBe(5)
    expect(at1.data!.damage.map((d) => [d.formula, d.damageType])).toEqual([['4d6', 'radiant']])
    expect(at1.data!.costs).toEqual([
      expect.objectContaining({ kind: 'slot', level: 1, amount: 1, sufficient: true }),
    ])
    const rolled = await trpcMutation<{ id: string }>(
      t.app,
      'characters.roll',
      { characterId: cleric, ref: { kind: 'spell', spellUid: GUIDING_BOLT, slotLevel: 1 } },
      admin.cookie,
    )
    expect(rolled.status).toBe(200)
    const commandId = randomUUID()
    const body = { characterId: cleric, commandId, expectedRevision: rev, rollId: rolled.data!.id }
    const first = await trpcMutation<{
      revision: number
      replayed: boolean
      aggregate: CharacterAggregate
    }>(t.app, 'characters.commitAction', body, admin.cookie)
    expect(first.status).toBe(200)
    expect(first.data!.aggregate.state.spellSlotsUsed).toEqual({ '1': 1 })
    const retry = await trpcMutation<{
      revision: number
      replayed: boolean
      aggregate: CharacterAggregate
    }>(t.app, 'characters.commitAction', body, admin.cookie)
    expect(retry.status).toBe(200)
    expect(retry.data!.replayed).toBe(true)
    expect(retry.data!.aggregate.state.spellSlotsUsed).toEqual({ '1': 1 })
    rev = first.data!.revision
    // A level-1 cleric has no level-2 slot: the upcast plan is blocked, not silently cast lower.
    const at2 = await trpcQuery<ActionPlan>(
      t.app,
      'characters.plan',
      { characterId: cleric, ref: { kind: 'spell', spellUid: GUIDING_BOLT, slotLevel: 2 } },
      admin.cookie,
    )
    expect(at2.data!.damage[0]!.formula).toBe('5d6')
    expect(at2.data!.blocked).toMatch(/level 2 spell slots/)
  })
})

describe('live updates', () => {
  it('streams ready and character.changed to the owner and refuses strangers', async () => {
    const address = await t.app.listen({ port: 0, host: '127.0.0.1' })
    const port = (t.app.server.address() as AddressInfo).port
    expect(address).toContain(String(port))
    const input = encodeURIComponent(JSON.stringify({ characterId: id }))
    const url = `http://127.0.0.1:${port}/api/trpc/characters.subscribe?input=${input}`

    // The stream opens before the procedure runs, so a refusal arrives as an error frame.
    const anonymous = await fetch(url, { headers: { accept: 'text/event-stream' } })
    const refusal = await anonymous.text()
    expect(refusal).toContain('UNAUTHORIZED')
    expect(refusal).not.toContain('"ready"')

    const controller = new AbortController()
    const response = await fetch(url, {
      headers: { accept: 'text/event-stream', cookie: admin.cookie },
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const readUntil = async (needle: string) => {
      const deadline = Date.now() + 10_000
      while (!text.includes(needle) && Date.now() < deadline) {
        const { value, done } = await reader.read()
        if (done) break
        text += decoder.decode(value, { stream: true })
      }
      expect(text).toContain(needle)
    }
    await readUntil('"ready"')
    expect(text).toContain(`"revision":${revision}`)
    const damaged = await trpcMutation<{ revision: number }>(
      t.app,
      'characters.command',
      {
        characterId: id,
        commandId: randomUUID(),
        expectedRevision: revision,
        command: { type: 'applyDamage', amount: 1 },
      },
      admin.cookie,
    )
    revision = damaged.data!.revision
    await readUntil('character.changed')
    expect(text).toContain(`"revision":${revision}`)
    controller.abort()
    await reader.cancel().catch(() => undefined)
  }, 30_000)
})

describe('shutdown with a live stream open', () => {
  it('closes within seconds instead of waiting for the subscription to end', async () => {
    const other = await createTestApp(t.tdb)
    await other.app.listen({ port: 0, host: '127.0.0.1' })
    const port = (other.app.server.address() as AddressInfo).port
    const input = encodeURIComponent(JSON.stringify({ characterId: id }))
    const response = await fetch(
      `http://127.0.0.1:${port}/api/trpc/characters.subscribe?input=${input}`,
      { headers: { accept: 'text/event-stream', cookie: admin.cookie } },
    )
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    await reader.read() // the ready frame: the stream is live
    const started = Date.now()
    await other.app.close()
    expect(Date.now() - started).toBeLessThan(5_000)
    // The client sees the stream end (an error or done), never a hang.
    await expect(
      reader
        .read()
        .then((r) => r.done)
        .catch(() => true),
    ).resolves.toBe(true)
    fs.rmSync(other.dataDir, { recursive: true, force: true })
  }, 30_000)
})
