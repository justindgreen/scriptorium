import {
  ABILITIES,
  SKILLS,
  parseUid,
  type ContentEntry,
  type ContentEntryOf,
  type Effect,
  type ItemData,
} from '@scriptorium/content-schema'
import { expandHook } from '../hooks/index.js'
import { entryOfKind, speciesChain } from '../snapshot.js'
import type {
  CharacterAggregate,
  ContentSnapshot,
  Diagnostic,
  FeatureView,
  InventoryItem,
  PendingChoice,
  SourceKind,
  SourceRef,
  ToggleView,
} from '../types.js'
import { applySelection, type ChoiceDefinition } from './choices.js'
import type { PredicateFacts, SelfItem } from './predicates.js'

export type ItemSelf = SelfItem & { itemId: string; itemName: string }

export type EffectInstance = {
  effect: Effect
  source: SourceRef
  self?: ItemSelf
  active: boolean
  inactiveReason?: string
}

export type ClassGrant = {
  entry: ContentEntryOf<'class'>
  subclass?: ContentEntryOf<'subclass'>
  level: number
  order: number
  hitDiceRolls: number[]
  source: SourceRef
  subclassSource?: SourceRef
}

export type ArmorData = NonNullable<ItemData['armor']>
export type WeaponData = NonNullable<ItemData['weapon']>

export type EquippedArmor = {
  item: InventoryItem
  entry: ContentEntryOf<'item'>
  data: ArmorData
  source: SourceRef
}
/** A shield is an item of category `shield`; its AC bonus is an ordinary effect on the item. */
export type EquippedShield = {
  item: InventoryItem
  entry: ContentEntryOf<'item'>
  source: SourceRef
}
export type WeaponInstance = {
  item: InventoryItem
  entry: ContentEntryOf<'item'>
  data: WeaponData
  source: SourceRef
  active: boolean
}

export type ProficiencySets = {
  armor: Map<string, SourceRef[]>
  weapons: Map<string, SourceRef[]>
  tools: Map<string, SourceRef[]>
  languages: Map<string, SourceRef[]>
}

export type Grants = {
  effects: EffectInstance[]
  features: FeatureView[]
  choiceDefinitions: ChoiceDefinition[]
  pendingChoices: PendingChoice[]
  toggles: ToggleView[]
  classes: ClassGrant[]
  species: ContentEntryOf<'species'>[]
  speciesSpeed?: number
  speciesSize?: string
  speciesSource?: SourceRef
  armor?: EquippedArmor
  shield?: EquippedShield
  weapons: WeaponInstance[]
  proficiencies: ProficiencySets
  /** Content picked through `content` choices (spells); consumed from M2.3. */
  contentSelections: Array<{ key: string; uids: string[] }>
  facts: PredicateFacts
  diagnostics: Diagnostic[]
  engineSource: SourceRef
  rulesetSource: SourceRef
}

const EXHAUSTION_SPEEDS = ['walk', 'fly', 'swim', 'climb', 'burrow'] as const

/**
 * Walks the character in the canonical grants order (docs/RULES_ENGINE.md §2): species →
 * background → class levels → subclass → choices and feats → items → conditions → toggles →
 * temporary effects. Produces effect instances with source paths; nothing is resolved here.
 */
export function collectGrants(aggregate: CharacterAggregate, snapshot: ContentSnapshot): Grants {
  return new Walker(aggregate, snapshot).run()
}

class Walker {
  private order = 0
  private readonly featureStack: string[] = []
  private readonly result: Grants

  constructor(
    private readonly aggregate: CharacterAggregate,
    private readonly snapshot: ContentSnapshot,
  ) {
    this.result = {
      effects: [],
      features: [],
      choiceDefinitions: [],
      pendingChoices: [],
      toggles: [],
      classes: [],
      species: [],
      weapons: [],
      proficiencies: {
        armor: new Map(),
        weapons: new Map(),
        tools: new Map(),
        languages: new Map(),
      },
      contentSelections: [],
      facts: {
        level: 0,
        classLevels: new Map(),
        speciesChain: new Set(),
        subclasses: new Set(),
        features: new Set(),
        conditions: new Set(),
        activeToggles: new Set(),
        armorCategory: 'none',
        shield: false,
        equippedItems: new Set(),
        attunedItems: new Set(),
      },
      diagnostics: [],
      engineSource: { kind: 'engine', name: 'Engine', path: 'engine', order: -2 },
      rulesetSource: { kind: 'ruleset', name: 'Ruleset', path: 'ruleset', order: -1 },
    }
  }

  run(): Grants {
    const { definition, state } = this.aggregate
    this.result.facts.level = definition.classes.reduce((sum, c) => sum + c.level, 0)
    for (const c of definition.classes) {
      this.result.facts.classLevels.set(
        c.classUid,
        (this.result.facts.classLevels.get(c.classUid) ?? 0) + c.level,
      )
    }
    this.walkSpecies()
    this.walkBackground()
    this.walkClasses()
    this.walkItems()
    this.walkConditions()
    this.walkExhaustion(state.exhaustion)
    this.walkTemporary()
    return this.result
  }

  // ------------------------------------------------------------------------------ helpers

  private source(kind: SourceKind, name: string, path: string, uid?: string): SourceRef {
    const ref: SourceRef = { kind, name, path, order: this.order++ }
    if (uid) ref.uid = uid
    return ref
  }

  private diagnostic(d: Diagnostic) {
    this.result.diagnostics.push(d)
  }

  private missing(uid: string, what: string, source: SourceRef) {
    this.diagnostic({
      code: 'MISSING_CONTENT',
      severity: 'error',
      message: `${what} "${uid}" is not in the content snapshot`,
      sources: [source],
    })
  }

  private addProficiency(set: keyof ProficiencySets, id: string, source: SourceRef) {
    const map = this.result.proficiencies[set]
    const list = map.get(id)
    if (list) list.push(source)
    else map.set(id, [source])
  }

  /** Pushes effects, expanding nesting constructs (feature.grant, toggle.define, hook). */
  private pushEffects(
    effects: Effect[],
    source: SourceRef,
    self: ItemSelf | undefined,
    active: boolean,
    inactiveReason?: string,
    classUid?: string,
  ) {
    for (const effect of effects) {
      switch (effect.type) {
        case 'feature.grant':
          if (active) this.grantFeature(effect.feature, source, classUid)
          break
        case 'toggle.define': {
          const toggle = effect.toggle
          const toggleActive = active && this.aggregate.state.toggles[toggle.id] === true
          this.result.toggles.push({
            id: toggle.id,
            name: toggle.name,
            description: toggle.description,
            active: toggleActive,
            cost: toggle.cost,
            durationNote: toggle.durationNote,
            source,
          })
          if (toggleActive) {
            this.result.facts.activeToggles.add(toggle.id)
            const toggleSource = this.source(
              'toggle',
              toggle.name,
              `${source.path}/toggle:${toggle.id}`,
            )
            this.pushEffects(
              toggle.effects as Effect[],
              toggleSource,
              self,
              true,
              undefined,
              classUid,
            )
          }
          break
        }
        case 'hook': {
          const expansion = expandHook(effect, { source, classUid })
          if ('diagnostic' in expansion) this.diagnostic(expansion.diagnostic)
          else this.pushEffects(expansion.effects, source, self, active, inactiveReason, classUid)
          break
        }
        default:
          this.result.effects.push(
            inactiveReason
              ? { effect, source, self, active, inactiveReason }
              : { effect, source, self, active },
          )
      }
    }
  }

  /** Effects and choices declared on an entry. */
  private expandEntry(
    entry: ContentEntry,
    source: SourceRef,
    options: { self?: ItemSelf; active?: boolean; inactiveReason?: string; classUid?: string } = {},
  ) {
    const active = options.active ?? true
    this.pushEffects(
      entry.effects,
      source,
      options.self,
      active,
      options.inactiveReason,
      options.classUid,
    )
    if (!active) return
    for (const choice of entry.choices) {
      this.resolveChoice({ key: `${source.path}/${choice.key}`, choice, source }, options.classUid)
    }
  }

  private resolveChoice(definition: ChoiceDefinition, classUid?: string) {
    this.result.choiceDefinitions.push(definition)
    const selection = this.aggregate.definition.choices[definition.key]
    const outcome = applySelection(definition, selection)
    for (const d of outcome.diagnostics) this.diagnostic(d)
    for (const grant of outcome.grants) {
      const source = this.source('choice', grant.name, grant.path)
      this.pushEffects(grant.effects, source, undefined, true, undefined, classUid)
    }
    for (const uid of outcome.featureUids) this.grantFeature(uid, definition.source, classUid)
    for (const uid of outcome.featUids) this.grantFeat(uid, definition)
    if (outcome.contentUids.length > 0) {
      this.result.contentSelections.push({ key: definition.key, uids: outcome.contentUids })
    }
    if (outcome.pending) this.result.pendingChoices.push(outcome.pending)
  }

  private grantFeature(uid: string, parent: SourceRef, classUid?: string) {
    const entry = entryOfKind(this.snapshot, uid, 'feature')
    if (!entry) {
      this.missing(uid, 'feature', parent)
      return
    }
    if (this.featureStack.includes(uid)) {
      this.diagnostic({
        code: 'CYCLE_DETECTED',
        severity: 'error',
        message: `feature "${entry.name}" grants itself (${[...this.featureStack, uid].join(' -> ')})`,
        sources: [parent],
      })
      return
    }
    const source = this.source('feature', entry.name, `${parent.path}/feature:${entry.slug}`, uid)
    this.registerFeature(entry, source)
    this.featureStack.push(uid)
    this.expandEntry(entry, source, { classUid })
    this.featureStack.pop()
  }

  private grantFeat(uid: string, definition: ChoiceDefinition) {
    const entry = entryOfKind(this.snapshot, uid, 'feat')
    if (!entry) {
      this.missing(uid, 'feat', definition.source)
      return
    }
    const source = this.source('feat', entry.name, `${definition.key}/feat:${entry.slug}`, uid)
    this.registerFeature(entry, source)
    this.expandEntry(entry, source)
  }

  private registerFeature(entry: ContentEntry, source: SourceRef) {
    this.result.facts.features.add(entry.uid)
    const view: FeatureView = {
      uid: entry.uid,
      name: entry.name,
      source,
      automation: entry.automation?.level ?? 'none',
      manualText: entry.effects.flatMap((e) => (e.type === 'manual' ? [e.text] : [])),
    }
    if (entry.automation?.manualParts) view.manualParts = entry.automation.manualParts
    this.result.features.push(view)
  }

  // -------------------------------------------------------------------------------- walks

  private walkSpecies() {
    const uid = this.aggregate.definition.speciesUid
    if (!uid) return
    const chain = speciesChain(this.snapshot, uid)
    if (chain.length === 0 || chain[chain.length - 1]!.uid !== uid) {
      this.missing(uid, 'species', this.result.engineSource)
    }
    for (const species of chain) {
      const source = this.source('species', species.name, `species:${species.uid}`, species.uid)
      this.result.species.push(species)
      this.result.facts.speciesChain.add(species.uid)
      if (species.data.size) this.result.speciesSize = species.data.size
      if (species.data.speed !== undefined) {
        this.result.speciesSpeed = species.data.speed
        this.result.speciesSource = source
      }
      this.expandEntry(species, source)
      for (const trait of species.data.traits) this.grantFeature(trait.uid, source)
    }
  }

  private walkBackground() {
    const uid = this.aggregate.definition.backgroundUid
    if (!uid) return
    const entry = entryOfKind(this.snapshot, uid, 'background')
    if (!entry) {
      this.missing(uid, 'background', this.result.engineSource)
      return
    }
    const source = this.source('background', entry.name, `background:${entry.uid}`, entry.uid)
    this.pushEffects(
      entry.data.skillProficiencies.map((skill) => ({
        type: 'proficiency.grant' as const,
        kind: 'skill' as const,
        target: skill,
        level: 'proficient' as const,
      })),
      source,
      undefined,
      true,
    )
    for (const tool of entry.data.toolProficiencies) this.addProficiency('tools', tool, source)
    if (entry.data.languages > 0) {
      this.resolveChoice({
        key: `${source.path}/languages`,
        choice: {
          type: 'choice',
          key: 'languages',
          name: 'Languages',
          count: entry.data.languages,
          from: { kind: 'language' },
        },
        source,
      })
    }
    this.result.features.push({
      uid: `${entry.uid}#feature`,
      name: entry.data.feature.name,
      source,
      automation: 'manual',
      manualText: [entry.data.feature.description],
    })
    this.expandEntry(entry, source)
  }

  private walkClasses() {
    const classes = [...this.aggregate.definition.classes].sort((a, b) => a.order - b.order)
    for (const taken of classes) {
      const entry = entryOfKind(this.snapshot, taken.classUid, 'class')
      if (!entry) {
        this.missing(taken.classUid, 'class', this.result.engineSource)
        continue
      }
      const source = this.source('class', entry.name, `class:${entry.uid}`, entry.uid)
      const grant: ClassGrant = {
        entry,
        level: taken.level,
        order: taken.order,
        hitDiceRolls: taken.hitDiceRolls ?? [],
        source,
      }
      this.result.classes.push(grant)

      if (taken.order === 0) {
        this.pushEffects(
          entry.data.savingThrows.map((ability) => ({
            type: 'proficiency.grant' as const,
            kind: 'save' as const,
            target: ability,
            level: 'proficient' as const,
          })),
          source,
          undefined,
          true,
          undefined,
          entry.uid,
        )
        const p = entry.data.proficiencies
        for (const id of p.armor) this.addProficiency('armor', id, source)
        for (const id of p.weapons) this.addProficiency('weapons', id, source)
        for (const id of p.tools) this.addProficiency('tools', id, source)
        this.resolveChoice(
          {
            key: `${source.path}@1/skills`,
            choice: {
              type: 'choice',
              key: 'skills',
              name: `${entry.name} skill proficiencies`,
              count: p.skills.count,
              from: { kind: 'skill', from: p.skills.from.filter(isSkill), expertise: false },
            },
            source,
          },
          entry.uid,
        )
        if (p.toolChoice) {
          this.resolveChoice(
            {
              key: `${source.path}@1/tools`,
              choice: {
                type: 'choice',
                key: 'tools',
                name: `${entry.name} tool proficiencies`,
                count: p.toolChoice.count,
                from: { kind: 'tool', from: p.toolChoice.from },
              },
              source,
            },
            entry.uid,
          )
        }
      } else {
        const multi = entry.data.multiclassing?.proficiencies
        if (multi) {
          for (const id of multi.armor) this.addProficiency('armor', id, source)
          for (const id of multi.weapons) this.addProficiency('weapons', id, source)
          for (const id of multi.tools) this.addProficiency('tools', id, source)
          if (multi.skills) {
            this.resolveChoice(
              {
                key: `${source.path}@1/multiclass-skills`,
                choice: {
                  type: 'choice',
                  key: 'multiclass-skills',
                  name: `${entry.name} skill proficiencies (multiclass)`,
                  count: multi.skills.count,
                  from: {
                    kind: 'skill',
                    from: multi.skills.from.filter(isSkill),
                    expertise: false,
                  },
                },
                source,
              },
              entry.uid,
            )
          }
        }
      }

      this.expandEntry(entry, source, { classUid: entry.uid })
      for (const row of entry.data.levels) {
        if (row.level > taken.level) continue
        const levelSource = this.source(
          'class',
          `${entry.name} ${row.level}`,
          `class:${entry.uid}@${row.level}`,
          entry.uid,
        )
        for (const uid of row.features) this.grantFeature(uid, levelSource, entry.uid)
      }

      if (taken.subclassUid) {
        const subclass = entryOfKind(this.snapshot, taken.subclassUid, 'subclass')
        if (!subclass) {
          this.missing(taken.subclassUid, 'subclass', source)
          continue
        }
        if (subclass.data.class !== entry.uid) {
          this.diagnostic({
            code: 'PREREQ_UNMET',
            severity: 'error',
            message: `subclass "${subclass.name}" belongs to ${subclass.data.class}, not ${entry.uid}`,
            sources: [source],
          })
        }
        grant.subclass = subclass
        this.result.facts.subclasses.add(subclass.uid)
        const subSource = this.source(
          'subclass',
          subclass.name,
          `subclass:${subclass.uid}`,
          subclass.uid,
        )
        grant.subclassSource = subSource
        this.expandEntry(subclass, subSource, { classUid: entry.uid })
        for (const row of subclass.data.levels) {
          if (row.level > taken.level) continue
          const levelSource = this.source(
            'subclass',
            `${subclass.name} ${row.level}`,
            `subclass:${subclass.uid}@${row.level}`,
            subclass.uid,
          )
          for (const uid of row.features) this.grantFeature(uid, levelSource, entry.uid)
        }
      }
    }
  }

  private walkItems() {
    const items = [...this.aggregate.inventory].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id),
    )
    for (const item of items) {
      const entry =
        item.customItem ??
        (item.itemUid ? entryOfKind(this.snapshot, item.itemUid, 'item') : undefined)
      if (!entry) {
        this.missing(item.itemUid ?? item.id, 'item', this.result.engineSource)
        continue
      }
      const source = this.source('item', entry.name, `item:${item.id}`, entry.uid)
      const needsAttunement = entry.data.requiresAttunement
      let active = item.equipped && (!needsAttunement || item.attuned)
      let inactiveReason = !item.equipped
        ? 'not equipped'
        : needsAttunement && !item.attuned
          ? 'not attuned'
          : undefined
      const self: ItemSelf = {
        uid: entry.uid,
        itemId: item.id,
        itemName: entry.name,
        equipped: item.equipped,
        attuned: item.attuned,
      }
      if (item.equipped) {
        this.result.facts.equippedItems.add(entry.uid)
        if (item.attuned) this.result.facts.attunedItems.add(entry.uid)
      }
      const isShield = entry.data.category === 'shield' || entry.data.armor?.category === 'shield'
      if (isShield && item.equipped) {
        if (this.result.shield) {
          this.warnDuplicate('shield', source)
          active = false
          inactiveReason = 'another shield is already equipped'
        } else {
          this.result.shield = { item, entry, source }
          this.result.facts.shield = true
        }
      } else if (entry.data.armor && item.equipped) {
        if (this.result.armor) {
          this.warnDuplicate('suit of armor', source)
          active = false
          inactiveReason = 'another suit of armor is already worn'
        } else {
          this.result.armor = { item, entry, data: entry.data.armor, source }
          this.result.facts.armorCategory = entry.data.armor.category as
            'light' | 'medium' | 'heavy'
        }
      }
      if (entry.data.weapon) {
        this.result.weapons.push({
          item,
          entry,
          data: entry.data.weapon,
          source,
          active: item.equipped,
        })
      }
      this.expandEntry(entry, source, { self, active, inactiveReason })
    }
  }

  private warnDuplicate(what: string, source: SourceRef) {
    this.diagnostic({
      code: 'PREREQ_UNMET',
      severity: 'warning',
      message: `more than one ${what} is equipped; "${source.name}" is ignored`,
      sources: [source],
    })
  }

  private walkConditions() {
    for (const condition of this.aggregate.state.conditions) {
      const slug = safeSlug(condition.uid)
      this.result.facts.conditions.add(slug)
      const entry = entryOfKind(this.snapshot, condition.uid, 'condition')
      const source = this.source(
        'condition',
        entry?.name ?? slug,
        `condition:${condition.uid}`,
        condition.uid,
      )
      if (entry) this.expandEntry(entry, source)
    }
  }

  /** 2014 exhaustion table (SRD "Conditions"); cumulative. */
  private walkExhaustion(level: number) {
    if (level <= 0) return
    const source = this.source('exhaustion', `Exhaustion ${level}`, `exhaustion:${level}`)
    const effects: Effect[] = []
    if (level >= 1) {
      for (const ability of ABILITIES)
        effects.push({ type: 'disadvantage', on: `check.${ability}` })
      for (const skill of SKILLS) effects.push({ type: 'disadvantage', on: `check.${skill}` })
    }
    if (level >= 2) {
      for (const mode of EXHAUSTION_SPEEDS)
        effects.push({ type: 'multiply', target: `speed.${mode}`, value: 0.5 })
    }
    if (level >= 3) {
      for (const kind of ['melee', 'ranged', 'spell'] as const)
        effects.push({ type: 'disadvantage', on: `attack.${kind}` })
      for (const ability of ABILITIES) effects.push({ type: 'disadvantage', on: `save.${ability}` })
    }
    if (level >= 4) effects.push({ type: 'multiply', target: 'hp.max', value: 0.5 })
    if (level >= 5) {
      for (const mode of EXHAUSTION_SPEEDS)
        effects.push({ type: 'replaceFinal', target: `speed.${mode}`, value: 0, priority: 100 })
    }
    if (level >= 6) {
      this.diagnostic({
        code: 'MANUAL_FEATURE',
        severity: 'warning',
        message: 'Exhaustion level 6: the character is dead',
        sources: [source],
      })
    }
    this.pushEffects(effects, source, undefined, true)
  }

  private walkTemporary() {
    for (const temporary of this.aggregate.state.activeEffects) {
      const source = this.source('temporary', temporary.name, `temporary:${temporary.id}`)
      this.pushEffects(temporary.effects, source, undefined, true)
    }
  }
}

function isSkill(value: string): value is (typeof SKILLS)[number] {
  return (SKILLS as readonly string[]).includes(value)
}

function safeSlug(uid: string): string {
  try {
    return parseUid(uid).slug
  } catch {
    return uid
  }
}
