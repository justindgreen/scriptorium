/**
 * Engine input and output types (docs/RULES_ENGINE.md §1–§3). The server maps database rows onto
 * these shapes; the browser receives them from the API. Nothing here depends on I/O.
 */
import type {
  Ability,
  ActionEffect,
  ContentEntry,
  ContentEntryOf,
  Effect,
  Predicate,
  RulesetConfig,
  Skill,
} from '@scriptorium/content-schema'

export type { Ability, Skill }

// ------------------------------------------------------------------------------------ aggregate

export type AbilityScores = Record<Ability, number>

/** What the builder stored for one choice key. The `kind` must match the choice's source kind. */
export type ChoiceSelection =
  | { kind: 'optionSet'; options: string[] }
  | { kind: 'skill'; skills: Skill[] }
  | { kind: 'tool'; tools: string[] }
  | { kind: 'language'; languages: string[] }
  | { kind: 'abilityIncrease'; increases: Partial<Record<Ability, number>> }
  | { kind: 'feat'; feats: string[] }
  | { kind: 'content'; entries: string[] }
  | { kind: 'expertise'; skills: Skill[] }
  | {
      kind: 'asiOrFeat'
      choice: 'asi' | 'feat'
      increases?: Partial<Record<Ability, number>>
      feat?: string
    }

export type CharacterClassEntry = {
  classUid: string
  subclassUid?: string
  level: number
  /** 0 for the first class taken; later classes get limited proficiencies (2014 multiclassing). */
  order: number
  /** One roll per class level when `hpMode` is `rolled` (the first character level is maxed). */
  hitDiceRolls?: number[]
}

export type CharacterSpell = {
  spellUid: string
  origin: string
  known: boolean
  prepared: boolean
  alwaysPrepared: boolean
}

export type StatOverride = { statPath: string; value: number | string | boolean; note?: string }

export type CharacterDefinition = {
  abilityMethod: 'standard' | 'point_buy' | 'manual' | 'rolled'
  baseAbilities: AbilityScores
  speciesUid?: string
  backgroundUid?: string
  classes: CharacterClassEntry[]
  choices: Record<string, ChoiceSelection>
  spells: CharacterSpell[]
  overrides: StatOverride[]
  hpMode: 'fixed' | 'rolled' | 'manual'
  xp: number
}

export type InventoryItem = {
  id: string
  itemUid?: string
  /** A one-off item not published as content (validated with the item entry schema). */
  customItem?: ContentEntryOf<'item'>
  quantity: number
  equipped: boolean
  attuned: boolean
  chargesCurrent?: number
  containerItemId?: string
  notes?: string
  sortOrder?: number
}

export type ActiveCondition = { uid: string; level?: number; source?: string }

/** A temporary effect applied by a spell, the DM or the player (state.active_effects). */
export type TemporaryEffect = {
  id: string
  name: string
  effects: Effect[]
  source?: string
  note?: string
}

export type CombatState = {
  turn: { encounterId: string | null; round: number | null; turnId: string; ownTurn: boolean }
  oncePerTurn: Record<string, string>
  reaction: { usedOnTurnId: string | null }
  bonusAction: { usedOnTurnId: string | null }
  actions: { budget: number; usedOnTurnId: string | null }
}

export type CharacterState = {
  hpCurrent: number
  hpTemp: number
  deathSaves: { successes: number; failures: number }
  hitDiceSpent: Record<string, number>
  spellSlotsUsed: Record<string, number>
  pactSlotsUsed: number
  resources: Record<string, number>
  conditions: ActiveCondition[]
  exhaustion: number
  concentration: { spellUid: string; startedTurnId?: string } | null
  inspiration: boolean
  currency: { cp: number; sp: number; ep: number; gp: number; pp: number }
  activeEffects: TemporaryEffect[]
  toggles: Record<string, boolean>
  combat: CombatState
  assumptions: Record<string, unknown>
}

export type CharacterAggregate = {
  id: string
  rulesetId: string
  name: string
  revision: number
  definition: CharacterDefinition
  inventory: InventoryItem[]
  state: CharacterState
}

// ------------------------------------------------------------------------------------- inputs

/** The pinned content versions a character references, plus transitive references. */
export type ContentSnapshot = {
  get(uid: string): ContentEntry | undefined
  has(uid: string): boolean
  entries(): ContentEntry[]
}

export type RulesetProfile = {
  config: RulesetConfig
  proficiencyBonus(level: number): number
  abilityScoreCap: number
}

// ------------------------------------------------------------------------------------- output

export type SourceKind =
  | 'engine'
  | 'ruleset'
  | 'species'
  | 'background'
  | 'class'
  | 'subclass'
  | 'feature'
  | 'feat'
  | 'choice'
  | 'item'
  | 'condition'
  | 'exhaustion'
  | 'toggle'
  | 'temporary'
  | 'override'

export type SourceRef = {
  kind: SourceKind
  uid?: string
  name: string
  /** Stable path for tests and the "Why?" view, e.g. `class:srd-5.1:class:fighter@1/feature:second-wind`. */
  path: string
  /** Position in the canonical grants order; breaks ties deterministically. */
  order: number
}

export type StatValueKind = 'number' | 'string' | 'boolean' | 'set'
export type StatScalar = number | string | boolean | string[]

export type ContributionOp =
  | 'base'
  | 'formula'
  | 'replace'
  | 'add'
  | 'multiply'
  | 'atLeast'
  | 'atMost'
  | 'replaceFinal'
  | 'override'
  | 'union'
  | 'remove'

export type BreakdownLine = {
  source: SourceRef
  op: ContributionOp
  /** The evaluated amount, or null when it could not be evaluated. */
  value: StatScalar | null
  /** Label for formula-group members and formulas. */
  label?: string
  note?: string
  applied: boolean
  reason?:
    | 'condition-false'
    | 'cycle'
    | 'formula-error'
    | 'lost-priority'
    | 'lost-group'
    | 'stack-key'
    | 'overridden'
    | 'unused-clamp'
}

export type StatValue = {
  path: string
  kind: StatValueKind
  value: StatScalar
  breakdown: BreakdownLine[]
  override?: { auto: StatScalar; manual: StatScalar; note?: string }
  error?: true
}

export type DiagnosticCode =
  | 'CYCLE_DETECTED'
  | 'UNKNOWN_VARIABLE'
  | 'FORMULA_ERROR'
  | 'SCOPE_VIOLATION'
  | 'UNSUPPORTED_EFFECT'
  | 'UNKNOWN_HOOK'
  | 'CONFLICTING_REPLACE'
  | 'PREREQ_UNMET'
  | 'PROFICIENCY_VIOLATION'
  | 'MANUAL_FEATURE'
  | 'PARTIAL_AUTOMATION'
  | 'MISSING_CONTENT'
  | 'INVALID_SELECTION'
  | 'HP_ROLL_MISSING'

export type Diagnostic = {
  code: DiagnosticCode
  severity: 'error' | 'warning' | 'info'
  message: string
  statPath?: string
  sources: SourceRef[]
}

export type PendingChoiceOption = { id: string; name: string; disabledReason?: string }

export type PendingChoice = {
  key: string
  name: string
  description?: string
  count: number
  remaining: number
  from: { kind: string } & Record<string, unknown>
  /** Enumerated when the engine can list the legal options itself. */
  options?: PendingChoiceOption[]
  selected: string[]
  source: SourceRef
}

export type FeatureView = {
  uid: string
  name: string
  source: SourceRef
  automation: 'full' | 'partial' | 'manual' | 'pending' | 'none'
  manualParts?: string[]
  /** Text of `manual` effects, shown with a manual badge. */
  manualText: string[]
}

export type ProficiencyView = { id: string; sources: SourceRef[] }

export type ResourceView = {
  id: string
  name: string
  max: StatValue
  current: number
  recharge: string
  rechargeAmount?: number
  displayDie?: string
  source: SourceRef
}

export type DefenseView = {
  kind: 'resistance' | 'immunity' | 'vulnerability'
  damageType: string
  condition?: Predicate
  source: SourceRef
}

/** One inventory row as the engine resolved it: name from content, activation, charges. */
export type ItemView = {
  itemId: string
  uid?: string
  name: string
  category?: string
  quantity: number
  equipped: boolean
  attuned: boolean
  requiresAttunement: boolean
  /** Whether its effects apply right now. */
  active: boolean
  inactiveReason?: string
  charges?: { current: number; max: number | null }
}

export type ToggleView = {
  id: string
  name: string
  description?: string
  active: boolean
  cost?: unknown
  durationNote?: string
  source: SourceRef
}

export type DamageLine = {
  dice: string | null
  bonus: number
  damageType: string
  /** Display text such as `1d8 + 3 slashing`. */
  text: string
  label?: string
}

export type ActionTemplate = {
  id: string
  name: string
  kind: 'weapon' | 'unarmed' | 'action'
  actionType: 'action' | 'bonus' | 'reaction' | 'free' | 'special'
  itemId?: string
  attackType?: 'melee' | 'ranged' | 'spell'
  attack?: { bonus: number; breakdown: BreakdownLine[]; proficient: boolean; ability?: Ability }
  damage: DamageLine[]
  save?: { ability: Ability; dc: number | 'spell'; onSuccess: string }
  healing?: string
  /** Conditional lines shown on the card; applied by action resolution (M2.3). */
  riders: Array<{ text: string; source: SourceRef }>
  range?: { normal: number; long?: number }
  reach?: number
  properties: string[]
  weaponCategory?: 'simple' | 'martial'
  magical?: boolean
  cost?: unknown
  source: SourceRef
}

export type ComputedSheet = {
  engineVersion: string
  rulesetId: string
  characterId: string
  revision: number
  level: number
  classes: Array<{
    classUid: string
    name: string
    subclassUid?: string
    subclassName?: string
    level: number
    hitDie: string
  }>
  stats: Record<string, StatValue>
  proficiencies: {
    armor: ProficiencyView[]
    weapons: ProficiencyView[]
    tools: ProficiencyView[]
    languages: ProficiencyView[]
  }
  features: FeatureView[]
  resources: ResourceView[]
  defenses: DefenseView[]
  conditionImmunities: Array<{ condition: string; source: SourceRef }>
  toggles: ToggleView[]
  items: ItemView[]
  actionTemplates: ActionTemplate[]
  pendingChoices: PendingChoice[]
  diagnostics: Diagnostic[]
  hitDice: Array<{ die: string; max: number; spent: number }>
  hp: { max: number; current: number; temp: number }
  spellcasting: SpellcastingView | null
  /** Serializable facts about the character for action resolution. */
  facts: SheetFacts
  /** Action-scoped effects collected from active sources, for planAction. */
  actionEffects: ActionEffectView[]
}

export type SheetFacts = {
  level: number
  classLevels: Record<string, number>
  speciesChain: string[]
  subclasses: string[]
  features: string[]
  conditions: string[]
  activeToggles: string[]
  armorCategory: 'none' | 'light' | 'medium' | 'heavy'
  shield: boolean
  equippedItems: string[]
  attunedItems: string[]
}

export type ActionEffectView = { effect: ActionEffect; source: SourceRef; itemId?: string }

export type SpellcastingSource = {
  id: string
  name: string
  ability: Ability
  mod: number
  saveDC: number
  attack: number
  progression: 'full' | 'half' | 'third' | 'pact' | 'none'
  preparation: 'known' | 'prepared' | 'spellbook'
  list?: string
  classUid?: string
  classLevel?: number
  /** Contribution to the multiclass caster level. */
  casterLevels: number
  cantripsKnown?: number
  spellsKnown?: number
  preparedMax?: number
  alwaysPrepared: string[]
  source: SourceRef
}

export type SpellcastingView = {
  sources: SpellcastingSource[]
  /** Source whose ability drives `spell.saveDC` / `spell.attack` and `castingMod`. */
  primary: string
  casterLevel: number
  slots: Array<{ level: number; max: number; used: number }>
  pact: { slots: number; level: number; used: number } | null
  known: Array<{
    spellUid: string
    origin: string
    prepared: boolean
    alwaysPrepared: boolean
    cantrip: boolean
    level?: number
  }>
  granted: Array<{
    spellUid: string
    source: SourceRef
    uses?: { max: number; recharge: string }
    atWill: boolean
    castAtLevel?: number
    chargeCost?: number
    castingAbility?: Ability
  }>
  preparedCount: number
  /** Why spells cannot be cast right now (armor without proficiency). */
  blocked?: string
}
