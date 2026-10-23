import type { Predicate } from '@scriptorium/content-schema'
import { evaluatePacketPredicate } from './defenses.js'
import type {
  ActionOutcome,
  ActionPlan,
  ApplyPacketsResult,
  DamagePacket,
  PacketResolution,
  RollInputs,
  TargetDefense,
} from './types.js'

/**
 * Turns roll results into an outcome (docs/RULES_ENGINE.md §6). Nothing is rolled here: the
 * attack natural, the damage totals (rolled with the crit formula when the attack was a critical)
 * and any healing are inputs. Missing damage rolls are an error, never guessed.
 */
export function applyRolls(
  plan: ActionPlan,
  rolls: RollInputs,
  options: { targetAc?: number; saved?: boolean } = {},
): ActionOutcome {
  if (plan.blocked) throw new Error(`action is blocked: ${plan.blocked}`)
  const outcome: ActionOutcome = {
    ref: plan.ref,
    name: plan.name,
    packets: [],
    costs: plan.costs,
    oncePerTurnMarks: [],
  }
  let dealsDamage = true
  if (plan.attack) {
    if (!rolls.attack) throw new Error('attack roll is missing')
    const natural = rolls.attack.natural
    const total = rolls.attack.total ?? natural + plan.attack.bonus
    const critical = natural >= plan.attack.critRange
    const naturalOne = natural === 1
    const hit = critical
      ? true
      : naturalOne
        ? false
        : options.targetAc !== undefined
          ? total >= options.targetAc
          : null
    outcome.attack = {
      natural,
      total,
      critical,
      naturalOne,
      hit,
      ...(options.targetAc !== undefined ? { targetAc: options.targetAc } : {}),
    }
    dealsDamage = hit !== false
  }
  if (plan.check) {
    if (!rolls.check) throw new Error('check roll is missing')
    outcome.check = {
      natural: rolls.check.natural,
      total: rolls.check.total ?? rolls.check.natural + plan.check.bonus,
    }
  }
  // A saving throw is rolled by the target's side; `saved` is the table's answer (D-1). Until it
  // is known the full packets stand; a successful save halves (rounded down) or removes them per
  // the spell, and 'special' outcomes are left to the text.
  let factor = 1
  if (plan.save) {
    const applied =
      options.saved === true
        ? plan.save.onSuccess === 'half'
          ? 'half'
          : plan.save.onSuccess === 'none'
            ? 'none'
            : 'full'
        : 'full'
    outcome.save = {
      ...plan.save,
      ...(options.saved !== undefined ? { saved: options.saved } : {}),
      applied,
    }
    if (applied === 'none') dealsDamage = false
    if (applied === 'half') factor = 0.5
  }
  if (dealsDamage) {
    for (const spec of plan.damage) {
      const amount = rolls.damage?.[spec.id]
      if (amount === undefined)
        throw new Error(`damage roll for "${spec.label}" (${spec.id}) is missing`)
      const packet: DamagePacket = {
        id: spec.id,
        label: spec.label,
        amount: Math.max(0, Math.floor(Math.floor(amount) * factor)),
        damageType: spec.damageType,
        flags: spec.flags,
      }
      outcome.packets.push(packet)
    }
    outcome.oncePerTurnMarks = plan.oncePerTurnKeys
  }
  if (plan.healing !== undefined && rolls.healing !== undefined)
    outcome.healing = Math.max(0, Math.floor(rolls.healing))
  if (plan.actionType === 'action' || plan.actionType === 'bonus' || plan.actionType === 'reaction')
    outcome.economyMark = plan.actionType
  if (plan.concentration) outcome.concentration = true
  return outcome
}

export type PacketTargetState = { hpCurrent: number; hpTemp: number }

/**
 * Applies typed damage packets to a target's defenses and hit points (2014: immunity, then
 * resistance halves once, then vulnerability doubles once; temporary hit points absorb first).
 * Static leaves inside a defense's condition are decided by `isStatic` (false by default, which
 * is right for monsters whose conditions only use packet facts).
 */
export function applyPackets(
  defenses: TargetDefense[],
  state: PacketTargetState,
  packets: DamagePacket[],
  isStatic: (leaf: { leaf: string }) => boolean = () => false,
): ApplyPacketsResult {
  let hpTemp = Math.max(0, state.hpTemp)
  let hpCurrent = state.hpCurrent
  let damageTaken = 0
  let tempAbsorbed = 0
  const resolutions: PacketResolution[] = []
  for (const packet of packets) {
    const matching = (kind: TargetDefense['kind']) =>
      defenses.some(
        (d) =>
          d.kind === kind &&
          d.damageType === packet.damageType &&
          (!d.condition ||
            evaluatePacketPredicate(
              d.condition,
              packet.flags,
              packet.damageType,
              isStatic as never,
            )),
      )
    const modifiers: PacketResolution['modifiers'] = []
    let amount = packet.amount
    if (matching('immunity')) {
      modifiers.push('immunity')
      amount = 0
    } else {
      if (matching('resistance')) {
        modifiers.push('resistance')
        amount = Math.floor(amount / 2)
      }
      if (matching('vulnerability')) {
        modifiers.push('vulnerability')
        amount *= 2
      }
    }
    const fromTemp = Math.min(hpTemp, amount)
    hpTemp -= fromTemp
    tempAbsorbed += fromTemp
    const remainder = amount - fromTemp
    hpCurrent = Math.max(0, hpCurrent - remainder)
    damageTaken += amount
    resolutions.push({
      id: packet.id,
      damageType: packet.damageType,
      amount: packet.amount,
      taken: amount,
      modifiers,
    })
  }
  return { damageTaken, tempAbsorbed, state: { hpCurrent, hpTemp }, packets: resolutions }
}

/** A character's defenses in the shape `applyPackets` expects. */
export function defensesFromSheet(
  defenses: Array<{ kind: TargetDefense['kind']; damageType: string; condition?: Predicate }>,
): TargetDefense[] {
  return defenses.map((d) => ({
    kind: d.kind,
    damageType: d.damageType,
    ...(d.condition ? { condition: d.condition } : {}),
  }))
}
