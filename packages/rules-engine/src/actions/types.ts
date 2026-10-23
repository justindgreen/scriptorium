/** Contextual action resolution types (docs/RULES_ENGINE.md §6). */
import type { Ability, Predicate, Skill } from '@scriptorium/content-schema'
import type { BreakdownLine, Diagnostic, SourceRef } from '../types.js'

export type ActionType = 'action' | 'bonus' | 'reaction' | 'free' | 'special'
export type AttackType = 'melee' | 'ranged' | 'spell'
export type RollMode = 'normal' | 'advantage' | 'disadvantage'

export type ActionRef =
  | { kind: 'weapon'; itemId: string; twoHanded?: boolean; thrown?: boolean }
  | { kind: 'unarmed' }
  | { kind: 'action'; templateId: string }
  | { kind: 'spell'; spellUid: string; slotLevel?: number; sourceId?: string; usePact?: boolean }
  | { kind: 'check'; skill?: Skill; ability?: Ability }
  | { kind: 'save'; ability: Ability }

export type TargetDefense = {
  kind: 'resistance' | 'immunity' | 'vulnerability'
  damageType: string
  /** Packet-scope predicate (`packet.magical`, …); absent means unconditional. */
  condition?: Predicate
  note?: string
}

/** What is known about the target; every missing fact may become a question. */
export type TargetDescriptor = {
  name?: string
  creatureType?: string
  size?: string
  conditions?: string[]
  ac?: number
  defenses?: TargetDefense[]
}

export type ActionSituation = {
  advantageSources?: string[]
  disadvantageSources?: string[]
  allyAdjacentToTarget?: boolean
  hidden?: boolean
  firstAttackThisTurn?: boolean
  range?: 'normal' | 'long'
}

export type ActionContext = {
  target?: TargetDescriptor
  situation?: ActionSituation
  options?: {
    /** Packet ids (or once-per-turn keys) the player declines to use. */
    declineOptional?: string[]
    /** Answers to questions by id; override stored assumptions. */
    answers?: Record<string, unknown>
  }
}

export type Question = {
  id: string
  text: string
  kind: 'boolean' | 'creatureType' | 'size' | 'condition'
  assumed: unknown
  /** Plan parts the answer changes (packet ids, 'attack.mode'). */
  affects: string[]
}

export type Assumption = { id: string; value: unknown; text: string }

export type PacketFlags = {
  magical: boolean
  silvered: boolean
  adamantine: boolean
  fromSpell: boolean
  weapon: boolean
}

export type DamagePacketSpec = {
  id: string
  label: string
  /** Symbolic dice with variables substituted: `1d8 + 3`. */
  formula: string
  /** The formula with every dice term doubled, for critical hits. */
  critFormula: string
  damageType: string
  source: SourceRef
  optional: boolean
  oncePerTurnKey?: string
  flags: PacketFlags
}

export type AttackSpec = {
  attackType: AttackType
  bonus: number
  breakdown: BreakdownLine[]
  mode: RollMode
  advantageSources: string[]
  disadvantageSources: string[]
  critRange: number
  ability?: Ability
  proficient: boolean
}

export type SaveSpec = { ability: Ability; dc: number; onSuccess: 'half' | 'none' | 'special' }

export type CheckSpec = {
  label: string
  bonus: number
  breakdown: BreakdownLine[]
  mode: RollMode
  advantageSources: string[]
  disadvantageSources: string[]
}

export type CostSpec = {
  kind: 'resource' | 'slot' | 'pact' | 'charges'
  id?: string
  /** Slot level for slot costs. */
  level?: number
  amount: number
  available: number
  sufficient: boolean
}

export type EconomySpec = { kind: ActionType; available: boolean; reason?: string }

export type ActionPlan = {
  ref: ActionRef
  name: string
  actionType: ActionType
  economy: EconomySpec
  attack?: AttackSpec
  save?: SaveSpec
  check?: CheckSpec
  damage: DamagePacketSpec[]
  /** Packets left out and why (once per turn already used, declined). */
  excluded: Array<{ id: string; label: string; reason: string }>
  healing?: string
  concentration?: boolean
  costs: CostSpec[]
  riders: Array<{ text: string; source: SourceRef; when: 'hit' | 'crit' | 'always' }>
  questions: Question[]
  assumptions: Assumption[]
  oncePerTurnKeys: string[]
  diagnostics: Diagnostic[]
  /** Set when the action cannot be taken at all (no slot, unknown spell, …). */
  blocked?: string
}

/** Results supplied by the roll step or by the player. */
export type RollInputs = {
  attack?: { natural: number; total?: number }
  /** Damage totals by packet id, already rolled with the crit formula when the attack was a critical. */
  damage?: Record<string, number>
  healing?: number
  check?: { natural: number; total?: number }
}

export type DamagePacket = {
  id: string
  label: string
  amount: number
  damageType: string
  flags: PacketFlags
}

export type ActionOutcome = {
  ref: ActionRef
  name: string
  attack?: {
    natural: number
    total: number
    critical: boolean
    naturalOne: boolean
    /** null when the target AC is unknown: the table decides. */
    hit: boolean | null
    targetAc?: number
  }
  check?: { natural: number; total: number }
  /** The save the target had to make and, once the table decided, what the result did to the packets. */
  save?: SaveSpec & { saved?: boolean; applied?: 'full' | 'half' | 'none' }
  packets: DamagePacket[]
  healing?: number
  costs: CostSpec[]
  oncePerTurnMarks: string[]
  economyMark?: ActionType
  concentration?: boolean
}

export type PacketResolution = {
  id: string
  damageType: string
  amount: number
  taken: number
  modifiers: Array<'resistance' | 'immunity' | 'vulnerability'>
}

export type ApplyPacketsResult = {
  damageTaken: number
  tempAbsorbed: number
  state: { hpCurrent: number; hpTemp: number }
  packets: PacketResolution[]
}
