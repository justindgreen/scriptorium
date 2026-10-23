import { describe, expect, it } from 'vitest'
import { applyRolls, type ActionPlan, type PacketFlags } from '../src/index.js'

/** D-1: how the table's save result shapes a spell's damage packets. */
const flags: PacketFlags = {
  magical: true,
  silvered: false,
  adamantine: false,
  fromSpell: true,
  weapon: false,
}

function savePlan(onSuccess: 'half' | 'none' | 'special'): ActionPlan {
  return {
    ref: { kind: 'spell', spellUid: 'test:spell:bolt', slotLevel: 3 },
    name: 'Bolt',
    actionType: 'action',
    economy: { available: true, reason: null },
    save: { ability: 'dex', dc: 14, onSuccess },
    damage: [
      {
        id: 'spell',
        label: 'Bolt',
        formula: '8d6',
        critFormula: '16d6',
        damageType: 'fire',
        source: { path: 'test', name: 'Bolt' },
        optional: false,
        flags,
      },
    ],
    excluded: [],
    costs: [],
    riders: [],
    questions: [],
    assumptions: [],
    oncePerTurnKeys: [],
    diagnostics: [],
  } as unknown as ActionPlan
}

describe('saving-throw spells', () => {
  it('keeps the full packets until the table answers, halves on a success (rounded down) and records the result', () => {
    const pending = applyRolls(savePlan('half'), { damage: { spell: 27 } })
    expect(pending.packets.map((p) => p.amount)).toEqual([27])
    expect(pending.save).toMatchObject({ ability: 'dex', dc: 14, applied: 'full' })
    expect(pending.save?.saved).toBeUndefined()
    const failed = applyRolls(savePlan('half'), { damage: { spell: 27 } }, { saved: false })
    expect(failed.packets.map((p) => p.amount)).toEqual([27])
    expect(failed.save).toMatchObject({ saved: false, applied: 'full' })
    const halved = applyRolls(savePlan('half'), { damage: { spell: 27 } }, { saved: true })
    expect(halved.packets.map((p) => p.amount)).toEqual([13])
    expect(halved.save).toMatchObject({ saved: true, applied: 'half' })
  })

  it('removes the packets when a success means no damage, and leaves special outcomes to the text', () => {
    const none = applyRolls(savePlan('none'), { damage: { spell: 5 } }, { saved: true })
    expect(none.packets).toEqual([])
    expect(none.save).toMatchObject({ saved: true, applied: 'none' })
    expect(none.oncePerTurnMarks).toEqual([])
    const special = applyRolls(savePlan('special'), { damage: { spell: 5 } }, { saved: true })
    expect(special.packets.map((p) => p.amount)).toEqual([5])
    expect(special.save).toMatchObject({ saved: true, applied: 'full' })
  })
})
