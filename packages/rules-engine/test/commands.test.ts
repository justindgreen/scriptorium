import { describe, expect, it } from 'vitest'
import {
  applyCommand,
  canUndo,
  compensatingCommand,
  computeSheet,
  type CharacterAggregate,
  type CharacterCommand,
  type CommandResult,
  type ComputedSheet,
} from '../src/index.js'
import { buildAggregate, buildSnapshot, loadGoldenCases, loadRuleset } from './helpers/golden.js'

const ruleset = loadRuleset()
const cases = loadGoldenCases()
const golden = (name: string) => {
  const c = cases.find((x) => x.name === name)!
  return {
    snapshot: buildSnapshot(c.snapshotRefs ?? [], c.contentFiles ?? [], c.content ?? []),
    aggregate: buildAggregate(c.aggregate),
  }
}

function run(
  aggregate: CharacterAggregate,
  snapshot: ReturnType<typeof buildSnapshot>,
  command: CharacterCommand,
): { result: CommandResult; sheet: ComputedSheet } {
  const sheet = computeSheet(aggregate, snapshot, ruleset)
  return { result: applyCommand(aggregate, sheet, command, { snapshot, ruleset }), sheet }
}

function ok(result: CommandResult) {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  return result
}

describe('runtime state commands', () => {
  const { snapshot, aggregate } = golden('hill-dwarf-champion-5')

  it('applies damage through defenses and temporary hit points, never mutating the input', () => {
    const before = JSON.stringify(aggregate)
    const sheet = computeSheet(aggregate, snapshot, ruleset)
    aggregate.state.hpCurrent = sheet.hp.max
    aggregate.state.hpTemp = 5
    const poison = ok(
      applyCommand(aggregate, sheet, { type: 'applyDamage', amount: 11, damageType: 'poison' }),
    )
    expect(poison.aggregate.state.hpTemp).toBe(0) // 5 of the halved 5 absorbed
    expect(poison.aggregate.state.hpCurrent).toBe(sheet.hp.max)
    expect(poison.event.reversible).toBe(true)
    expect(poison.event.before.state?.hpTemp).toBe(5)
    expect(poison.event.after.state?.hpTemp).toBe(0)
    const slashing = ok(
      applyCommand(aggregate, sheet, { type: 'applyDamage', amount: 11, damageType: 'slashing' }),
    )
    expect(slashing.aggregate.state.hpCurrent).toBe(sheet.hp.max - 6)
    expect(
      JSON.stringify({ ...aggregate, state: { ...aggregate.state, hpCurrent: 0, hpTemp: 0 } }),
    ).toBe(
      JSON.stringify({
        ...JSON.parse(before),
        state: { ...JSON.parse(before).state, hpCurrent: 0, hpTemp: 0 },
      }),
    )
  })

  it('heals up to the maximum and sets temporary hit points', () => {
    const sheet = computeSheet(aggregate, snapshot, ruleset)
    const hurt = { ...aggregate, state: { ...aggregate.state, hpCurrent: 10 } }
    expect(
      ok(applyCommand(hurt, sheet, { type: 'heal', amount: 100 })).aggregate.state.hpCurrent,
    ).toBe(sheet.hp.max)
    expect(
      ok(applyCommand(hurt, sheet, { type: 'setTempHp', amount: 7 })).aggregate.state.hpTemp,
    ).toBe(7)
    expect(applyCommand(hurt, sheet, { type: 'heal', amount: -1 })).toMatchObject({
      ok: false,
      code: 'INVALID',
    })
  })

  it('tracks resources, conditions, exhaustion, toggles, currency and inspiration', () => {
    const { result } = run(aggregate, snapshot, { type: 'useResource', id: 'second-wind' })
    const used = ok(result).aggregate
    expect(used.state.resources['second-wind']).toBe(0)
    expect(run(used, snapshot, { type: 'useResource', id: 'second-wind' }).result).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT',
    })
    expect(
      ok(run(used, snapshot, { type: 'restoreResource', id: 'second-wind' }).result).aggregate.state
        .resources['second-wind'],
    ).toBe(1)
    expect(run(aggregate, snapshot, { type: 'useResource', id: 'nope' }).result).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })

    const grappled = ok(
      run(aggregate, snapshot, { type: 'applyCondition', uid: 'srd-5.1:condition:grappled' })
        .result,
    ).aggregate
    expect(grappled.state.conditions).toEqual([{ uid: 'srd-5.1:condition:grappled' }])
    expect(
      run(grappled, snapshot, { type: 'applyCondition', uid: 'srd-5.1:condition:grappled' }).result,
    ).toMatchObject({ ok: false })
    expect(
      ok(
        run(grappled, snapshot, { type: 'removeCondition', uid: 'srd-5.1:condition:grappled' })
          .result,
      ).aggregate.state.conditions,
    ).toEqual([])

    expect(
      ok(run(aggregate, snapshot, { type: 'setExhaustion', level: 2 }).result).aggregate.state
        .exhaustion,
    ).toBe(2)
    expect(run(aggregate, snapshot, { type: 'setExhaustion', level: 7 }).result).toMatchObject({
      ok: false,
    })
    expect(
      run(aggregate, snapshot, { type: 'toggle', id: 'rage', active: true }).result,
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(
      ok(run(aggregate, snapshot, { type: 'adjustCurrency', delta: { gp: 10, sp: 5 } }).result)
        .aggregate.state.currency,
    ).toMatchObject({ gp: 10, sp: 5 })
    expect(
      run(aggregate, snapshot, { type: 'adjustCurrency', delta: { gp: -1 } }).result,
    ).toMatchObject({ ok: false, code: 'INSUFFICIENT' })
    expect(
      ok(run(aggregate, snapshot, { type: 'setInspiration', value: true }).result).aggregate.state
        .inspiration,
    ).toBe(true)
  })

  it('rests restore the right things', () => {
    const sheet = computeSheet(aggregate, snapshot, ruleset)
    const tired = {
      ...aggregate,
      state: {
        ...aggregate.state,
        hpCurrent: 1,
        resources: { 'second-wind': 0, 'action-surge': 0 },
        exhaustion: 1,
      },
    }
    const short = ok(
      applyCommand(tired, sheet, {
        type: 'shortRest',
        hitDice: [
          { die: 'd10', roll: 8 },
          { die: 'd10', roll: 4 },
        ],
      }),
    )
    const conMod = sheet.stats['ability.con.mod']!.value as number
    expect(short.aggregate.state.hpCurrent).toBe(
      1 + Math.max(0, 8 + conMod) + Math.max(0, 4 + conMod),
    )
    expect(short.aggregate.state.hitDiceSpent).toEqual({ d10: 2 })
    expect(short.aggregate.state.resources).toEqual({})
    expect(short.event.reversible).toBe(false)
    expect(short.event.snapshotReason).toBe('rest')
    expect(
      applyCommand(tired, sheet, { type: 'shortRest', hitDice: [{ die: 'd8', roll: 1 }] }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' })

    const long = ok(
      applyCommand(
        { ...short.aggregate, state: { ...short.aggregate.state, hitDiceSpent: { d10: 4 } } },
        sheet,
        { type: 'longRest' },
      ),
    )
    expect(long.aggregate.state.hpCurrent).toBe(sheet.hp.max)
    expect(long.aggregate.state.hitDiceSpent).toEqual({ d10: 2 }) // regains half of 5 = 2
    expect(long.aggregate.state.exhaustion).toBe(0)
  })

  it('turn bookkeeping resets on your own turn and action outcomes are paid for', () => {
    const sheet = computeSheet(aggregate, snapshot, ruleset)
    const spent = {
      ...aggregate,
      state: {
        ...aggregate.state,
        combat: {
          ...aggregate.state.combat,
          turn: { encounterId: 'e', round: 1, turnId: 'e:1:1', ownTurn: true },
          reaction: { usedOnTurnId: 'e:1:1' },
          bonusAction: { usedOnTurnId: 'e:1:1' },
          actions: { budget: 1, usedOnTurnId: 'e:1:1' },
        },
      },
    }
    const other = ok(
      applyCommand(spent, sheet, {
        type: 'turnStarted',
        turnId: 'e:1:2',
        ownTurn: false,
        encounterId: 'e',
        round: 1,
      }),
    ).aggregate
    expect(other.state.combat.reaction.usedOnTurnId).toBe('e:1:1')
    const own = ok(
      applyCommand(other, sheet, {
        type: 'turnStarted',
        turnId: 'e:2:1',
        ownTurn: true,
        encounterId: 'e',
        round: 2,
      }),
    ).aggregate
    expect(own.state.combat.reaction.usedOnTurnId).toBeNull()
    expect(own.state.combat.bonusAction.usedOnTurnId).toBeNull()

    const outcome = ok(
      applyCommand(own, sheet, {
        type: 'applyActionOutcome',
        outcome: {
          ref: { kind: 'unarmed' },
          name: 'Unarmed Strike',
          packets: [],
          costs: [
            { kind: 'resource', id: 'second-wind', amount: 1, available: 1, sufficient: true },
          ],
          oncePerTurnMarks: ['sneak-attack'],
          economyMark: 'action',
        },
      }),
    ).aggregate
    expect(outcome.state.resources['second-wind']).toBe(0)
    expect(outcome.state.combat.oncePerTurn['sneak-attack']).toBe('e:2:1')
    expect(outcome.state.combat.actions.usedOnTurnId).toBe('e:2:1')
  })
})

describe('inventory commands', () => {
  const { snapshot, aggregate } = golden('stack-keys-and-clamps')

  it('equips, unequips and enforces attunement rules', () => {
    const sheet = computeSheet(aggregate, snapshot, ruleset)
    const bare = {
      ...aggregate,
      inventory: aggregate.inventory.map((i) => ({ ...i, equipped: false, attuned: false })),
    }
    const equipped = ok(applyCommand(bare, sheet, { type: 'equip', itemId: 'gauntlets' })).aggregate
    expect(equipped.inventory.find((i) => i.id === 'gauntlets')?.equipped).toBe(true)
    expect(applyCommand(equipped, sheet, { type: 'equip', itemId: 'gauntlets' })).toMatchObject({
      ok: false,
      code: 'INVALID',
    })
    const attuned = ok(
      applyCommand(equipped, sheet, { type: 'attune', itemId: 'gauntlets' }, { snapshot }),
    ).aggregate
    expect(attuned.inventory.find((i) => i.id === 'gauntlets')?.attuned).toBe(true)
    const three = {
      ...attuned,
      inventory: attuned.inventory.map((i) =>
        i.id === 'gauntlets' ? i : { ...i, equipped: true, attuned: i.id !== 'ring-b' },
      ),
    }
    expect(
      applyCommand(three, sheet, { type: 'attune', itemId: 'ring-b' }, { snapshot }),
    ).toMatchObject({ ok: false, code: 'LIMIT' })
    expect(
      ok(
        applyCommand(attuned, sheet, { type: 'unequip', itemId: 'gauntlets' }),
      ).aggregate.inventory.find((i) => i.id === 'gauntlets'),
    ).toMatchObject({ equipped: false, attuned: false })
  })

  it('adds and removes items and tracks charges', () => {
    const sheet = computeSheet(aggregate, snapshot, ruleset)
    const added = ok(
      applyCommand(
        aggregate,
        sheet,
        {
          type: 'addItem',
          itemId: 'wand',
          itemUid: 'golden:item:boots-of-striding',
          chargesCurrent: 3,
        },
        { snapshot },
      ),
    ).aggregate
    expect(added.inventory.some((i) => i.id === 'wand')).toBe(true)
    expect(
      applyCommand(
        aggregate,
        sheet,
        { type: 'addItem', itemUid: 'golden:item:nope' },
        { snapshot },
      ),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    const spent = ok(
      applyCommand(added, sheet, { type: 'spendCharges', itemId: 'wand', amount: 2 }),
    ).aggregate
    expect(spent.inventory.find((i) => i.id === 'wand')?.chargesCurrent).toBe(1)
    expect(
      applyCommand(spent, sheet, { type: 'spendCharges', itemId: 'wand', amount: 2 }),
    ).toMatchObject({ ok: false, code: 'INSUFFICIENT' })
    expect(
      ok(
        applyCommand(spent, sheet, { type: 'removeItem', itemId: 'wand' }),
      ).aggregate.inventory.some((i) => i.id === 'wand'),
    ).toBe(false)
  })
})

describe('definition commands', () => {
  const { snapshot, aggregate } = golden('multiclass-fighter-1-rogue-1')

  it('adds class levels with multiclass prerequisites and hit die validation', () => {
    const single = {
      ...aggregate,
      definition: {
        ...aggregate.definition,
        classes: [{ classUid: 'srd-5.1:class:fighter', level: 1, order: 0 }],
      },
    }
    const sheet = computeSheet(single, snapshot, ruleset)
    const rogue = ok(
      applyCommand(
        single,
        sheet,
        { type: 'addClassLevel', classUid: 'srd-5.1:class:rogue', hitDieRoll: 5 },
        { snapshot, ruleset },
      ),
    )
    expect(rogue.aggregate.definition.classes).toEqual([
      { classUid: 'srd-5.1:class:fighter', level: 1, order: 0 },
      { classUid: 'srd-5.1:class:rogue', level: 1, order: 1, hitDiceRolls: [5] },
    ])
    expect(rogue.event.snapshotReason).toBe('level_up')
    expect(rogue.event.reversible).toBe(false)
    expect(
      applyCommand(
        single,
        sheet,
        { type: 'addClassLevel', classUid: 'srd-5.1:class:rogue', hitDieRoll: 9 },
        { snapshot, ruleset },
      ),
    ).toMatchObject({ ok: false, code: 'INVALID' })
    const weak = {
      ...single,
      definition: {
        ...single.definition,
        baseAbilities: { ...single.definition.baseAbilities, dex: 12 },
      },
    }
    expect(
      applyCommand(
        weak,
        computeSheet(weak, snapshot, ruleset),
        { type: 'addClassLevel', classUid: 'srd-5.1:class:rogue' },
        { snapshot, ruleset },
      ),
    ).toMatchObject({ ok: false, code: 'PREREQ_UNMET' })
    const again = ok(
      applyCommand(
        rogue.aggregate,
        sheet,
        { type: 'addClassLevel', classUid: 'srd-5.1:class:fighter' },
        { snapshot, ruleset },
      ),
    ).aggregate
    expect(again.definition.classes[0]?.level).toBe(2)
    expect(
      ok(
        applyCommand(
          again,
          sheet,
          { type: 'removeClassLevel', classUid: 'srd-5.1:class:rogue' },
          { snapshot },
        ),
      ).aggregate.definition.classes,
    ).toHaveLength(1)
  })

  it('sets choices, overrides, abilities and subclasses with validation', () => {
    const sheet = computeSheet(aggregate, snapshot, ruleset)
    const chosen = ok(
      applyCommand(aggregate, sheet, {
        type: 'setChoice',
        key: 'class:srd-5.1:class:fighter@1/skills',
        selection: { kind: 'skill', skills: ['athletics', 'perception'] },
      }),
    ).aggregate
    expect(
      computeSheet(chosen, snapshot, ruleset).pendingChoices.some(
        (p) => p.key === 'class:srd-5.1:class:fighter@1/skills',
      ),
    ).toBe(false)
    expect(applyCommand(aggregate, sheet, { type: 'clearChoice', key: 'nope' })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    })

    const overridden = ok(
      applyCommand(aggregate, sheet, {
        type: 'setOverride',
        statPath: 'ac.total',
        value: 20,
        note: 'DM',
      }),
    ).aggregate
    expect(computeSheet(overridden, snapshot, ruleset).stats['ac.total']?.override).toMatchObject({
      manual: 20,
    })
    expect(
      ok(applyCommand(overridden, sheet, { type: 'clearOverride', statPath: 'ac.total' })).aggregate
        .definition.overrides,
    ).toEqual([])

    expect(
      applyCommand(
        aggregate,
        sheet,
        {
          type: 'setAbilities',
          method: 'standard',
          abilities: { str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 8 },
        },
        { ruleset },
      ),
    ).toMatchObject({ ok: false, code: 'INVALID' })
    expect(
      ok(
        applyCommand(
          aggregate,
          sheet,
          {
            type: 'setAbilities',
            method: 'standard',
            abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
          },
          { ruleset },
        ),
      ).aggregate.definition.abilityMethod,
    ).toBe('standard')
    expect(
      applyCommand(
        aggregate,
        sheet,
        {
          type: 'setAbilities',
          method: 'point_buy',
          abilities: { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 },
        },
        { ruleset },
      ),
    ).toMatchObject({ ok: false, code: 'INVALID' })
    expect(
      ok(
        applyCommand(
          aggregate,
          sheet,
          {
            type: 'setAbilities',
            method: 'point_buy',
            abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
          },
          { ruleset },
        ),
      ).aggregate.definition.baseAbilities.str,
    ).toBe(15)

    const champion = golden('hill-dwarf-champion-5')
    const lowFighter = {
      ...champion.aggregate,
      definition: {
        ...champion.aggregate.definition,
        classes: [{ classUid: 'srd-5.1:class:fighter', level: 2, order: 0 }],
      },
    }
    expect(
      applyCommand(
        lowFighter,
        computeSheet(lowFighter, champion.snapshot, ruleset),
        {
          type: 'setSubclass',
          classUid: 'srd-5.1:class:fighter',
          subclassUid: 'srd-5.1:subclass:champion',
        },
        { snapshot: champion.snapshot },
      ),
    ).toMatchObject({ ok: false, code: 'PREREQ_UNMET' })
    expect(applyCommand(aggregate, sheet, { type: 'setName', name: '   ' })).toMatchObject({
      ok: false,
    })
    expect(
      ok(applyCommand(aggregate, sheet, { type: 'setName', name: 'Two Hats' })).event.before.name,
    ).toBe('Two Hats')
  })
})

describe('undo', () => {
  const { snapshot, aggregate } = golden('hill-dwarf-champion-5')

  it('compensates with the recorded before sections and respects the limits', () => {
    const sheet = computeSheet(aggregate, snapshot, ruleset)
    const damaged = ok(
      applyCommand({ ...aggregate, state: { ...aggregate.state, hpCurrent: 30 } }, sheet, {
        type: 'applyDamage',
        amount: 9,
      }),
    )
    expect(damaged.aggregate.state.hpCurrent).toBe(21)
    const logged = {
      id: 'e1',
      type: damaged.event.type,
      before: damaged.event.before,
      reversible: damaged.event.reversible,
      revisionAfter: 1,
    }
    const check = canUndo([logged])
    expect(check.ok).toBe(true)
    const undone = ok(applyCommand(damaged.aggregate, sheet, compensatingCommand(logged)))
    expect(undone.aggregate.state.hpCurrent).toBe(30)
    expect(undone.event.type).toBe('undo')
    expect(
      canUndo([
        { id: 'e2', type: 'undo', before: {}, reversible: false, revisionAfter: 2 },
        logged,
      ]),
    ).toMatchObject({ ok: false })
    expect(
      canUndo([{ id: 'e3', type: 'longRest', before: {}, reversible: false, revisionAfter: 3 }]),
    ).toMatchObject({ ok: false, reason: expect.stringContaining('snapshot') })
    expect(canUndo([])).toMatchObject({ ok: false })
  })
})
