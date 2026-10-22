/** Character commands, patches and events (docs/RULES_ENGINE.md §8, ARCHITECTURE.md §5). */
import type { Ability, ContentEntryOf } from '@scriptorium/content-schema'
import type { ActionOutcome } from '../actions/types.js'
import type {
  CharacterAggregate,
  CharacterDefinition,
  CharacterSpell,
  CharacterState,
  ChoiceSelection,
  InventoryItem,
} from '../types.js'

export type Currency = CharacterState['currency']

export type CharacterCommand =
  // inventory
  | {
      type: 'addItem'
      itemId?: string
      itemUid?: string
      customItem?: ContentEntryOf<'item'>
      quantity?: number
      equipped?: boolean
      attuned?: boolean
      chargesCurrent?: number
    }
  | { type: 'removeItem'; itemId: string }
  | { type: 'equip'; itemId: string }
  | { type: 'unequip'; itemId: string }
  | { type: 'attune'; itemId: string }
  | { type: 'unattune'; itemId: string }
  | { type: 'spendCharges'; itemId: string; amount?: number }
  | { type: 'recharge'; itemId: string; amount?: number }
  // runtime state
  | { type: 'applyDamage'; amount: number; damageType?: string; magical?: boolean }
  | { type: 'heal'; amount: number }
  | { type: 'setTempHp'; amount: number }
  | { type: 'spendSlot'; level: number }
  | { type: 'restoreSlot'; level: number }
  | { type: 'spendPactSlot' }
  | { type: 'restorePactSlot' }
  | { type: 'useResource'; id: string; amount?: number }
  | { type: 'restoreResource'; id: string; amount?: number }
  | { type: 'applyCondition'; uid: string; level?: number }
  | { type: 'removeCondition'; uid: string }
  | { type: 'setExhaustion'; level: number }
  | { type: 'toggle'; id: string; active: boolean }
  | { type: 'adjustCurrency'; delta: Partial<Currency> }
  | { type: 'setInspiration'; value: boolean }
  | {
      type: 'shortRest'
      /**
       * Hit dice spent during the rest, by die (`d10`), with what each die showed. The engine adds
       * the Constitution modifier to every die (minimum 0 per die, 2014 rules).
       */
      hitDice?: Array<{ die: string; roll: number }>
    }
  | { type: 'longRest' }
  | {
      type: 'turnStarted'
      turnId: string
      ownTurn: boolean
      encounterId?: string | null
      round?: number | null
    }
  | { type: 'applyActionOutcome'; outcome: ActionOutcome }
  // definition
  | { type: 'setName'; name: string }
  | {
      type: 'setAbilities'
      method: CharacterDefinition['abilityMethod']
      abilities: Record<Ability, number>
    }
  | { type: 'setSpecies'; uid: string | null }
  | { type: 'setBackground'; uid: string | null }
  | { type: 'addClassLevel'; classUid: string; subclassUid?: string; hitDieRoll?: number }
  | { type: 'removeClassLevel'; classUid: string }
  | { type: 'setSubclass'; classUid: string; subclassUid: string | null }
  | { type: 'setChoice'; key: string; selection: ChoiceSelection }
  | { type: 'clearChoice'; key: string }
  | { type: 'setSpells'; spells: CharacterSpell[] }
  | { type: 'setHpMode'; mode: CharacterDefinition['hpMode'] }
  | { type: 'setOverride'; statPath: string; value: number | string | boolean; note?: string }
  | { type: 'clearOverride'; statPath: string }
  | { type: 'setAssumption'; id: string; value: unknown }
  // compensation and restore
  | { type: 'undo'; eventType: string; before: Patch }
  | {
      type: 'restoreSnapshot'
      snapshotId: string
      aggregate: Pick<CharacterAggregate, 'name' | 'definition' | 'inventory' | 'state'>
    }

export type CommandType = CharacterCommand['type']

/** The parts of the aggregate a command replaces. Sections not present are untouched. */
export type Patch = {
  name?: string
  definition?: CharacterDefinition
  inventory?: InventoryItem[]
  state?: CharacterState
}

export type CommandEvent = {
  type: CommandType
  payload: CharacterCommand
  /** The touched sections before and after, for the log and for undo. */
  before: Patch
  after: Patch
  reversible: boolean
  snapshotReason?: 'level_up' | 'rest' | 'manual'
  /** Human-readable account for the event log. */
  summary: string
}

export type CommandResult =
  | { ok: true; patch: Patch; event: CommandEvent; aggregate: CharacterAggregate }
  | { ok: false; code: CommandErrorCode; message: string }

export type CommandErrorCode =
  'NOT_FOUND' | 'INVALID' | 'INSUFFICIENT' | 'LIMIT' | 'PREREQ_UNMET' | 'UNSUPPORTED'

export const REVERSIBLE_COMMANDS: ReadonlySet<CommandType> = new Set<CommandType>([
  'applyDamage',
  'heal',
  'setTempHp',
  'spendSlot',
  'restoreSlot',
  'spendPactSlot',
  'restorePactSlot',
  'useResource',
  'restoreResource',
  'spendCharges',
  'recharge',
  'adjustCurrency',
  'applyCondition',
  'removeCondition',
  'setExhaustion',
  'toggle',
  'equip',
  'unequip',
  'attune',
  'unattune',
  'setInspiration',
])

/** Commands whose outcome is written to the event log but may not be undone (snapshots cover them). */
export const SNAPSHOT_COMMANDS: Partial<Record<CommandType, CommandEvent['snapshotReason']>> = {
  addClassLevel: 'level_up',
  removeClassLevel: 'level_up',
  shortRest: 'rest',
  longRest: 'rest',
}

/** How many events back undo may reach (docs/RULES_ENGINE.md §8). */
export const UNDO_WINDOW = 20

/** 2014 attunement limit. */
export const ATTUNEMENT_LIMIT = 3
