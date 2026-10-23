import {
  SKILLS,
  isActionEffect,
  type ActionEffect,
  type Predicate,
  type StaticEffect,
} from '@scriptorium/content-schema'
import type { DefenseView, Diagnostic, SourceRef } from '../types.js'
import type { EffectInstance, ProficiencySets } from './grants.js'
import type { Contribution, ContributionValue, StatResolver } from './resolver.js'

export type ResourceDefinitionInstance = {
  definition: Extract<StaticEffect, { type: 'resource.define' }>['resource']
  source: SourceRef
  condition?: Predicate
}

export type WeaponPropertyGrant = {
  property: string
  condition?: Predicate
  source: SourceRef
}

/** Everything the effect pass produces besides stat contributions. */
export type EffectOutputs = {
  resources: Map<string, ResourceDefinitionInstance>
  defenses: DefenseView[]
  conditionImmunities: Array<{ condition: string; source: SourceRef }>
  weaponPropertyGrants: WeaponPropertyGrant[]
  /** `action.grant` instances, turned into templates after resolution. */
  actionGrants: EffectInstance[]
  /** Action-scoped effects kept for action resolution (M2.3). */
  actionEffects: Array<EffectInstance & { effect: ActionEffect }>
  /** Spellcasting effects deferred to M2.3. */
  deferred: EffectInstance[]
  /** Contributions to `attack.weapon.self` / `damage.weapon.self`, per inventory row. */
  itemSelf: Map<string, Contribution[]>
}

export function createEffectOutputs(): EffectOutputs {
  return {
    resources: new Map(),
    defenses: [],
    conditionImmunities: [],
    weaponPropertyGrants: [],
    actionGrants: [],
    actionEffects: [],
    deferred: [],
    itemSelf: new Map(),
  }
}

const PROFICIENCY_LEVEL: Record<'proficient' | 'expertise' | 'half', number> = {
  proficient: 1,
  expertise: 2,
  half: 0.5,
}

function value(v: number | string): ContributionValue {
  return typeof v === 'number' ? v : { formula: v }
}

/**
 * Translates active effect instances into contributions and side outputs
 * (docs/RULES_ENGINE.md §4). Inactive instances (unequipped items) contribute nothing.
 */
export function applyEffects(
  instances: EffectInstance[],
  resolver: StatResolver,
  proficiencies: ProficiencySets,
  outputs: EffectOutputs,
  diagnostic: (d: Diagnostic) => void,
): void {
  instances.forEach((instance, index) => {
    if (!instance.active) return
    if (isActionEffect(instance.effect)) {
      outputs.actionEffects.push({ ...instance, effect: instance.effect })
      return
    }
    applyStatic(instance, instance.effect, index, resolver, proficiencies, outputs, diagnostic)
  })
}

function applyStatic(
  instance: EffectInstance,
  effect: StaticEffect,
  index: number,
  resolver: StatResolver,
  proficiencies: ProficiencySets,
  outputs: EffectOutputs,
  diagnostic: (d: Diagnostic) => void,
): void {
  const { source } = instance
  const base = { source, index, note: effect.note } as const
  const contribute = (c: Omit<Contribution, 'source' | 'index'>) => {
    const contribution: Contribution = { ...base, ...c }
    if (!contribution.note) delete contribution.note
    if (c.target === 'attack.weapon.self' || c.target === 'damage.weapon.self') {
      if (!instance.self) {
        diagnostic({
          code: 'SCOPE_VIOLATION',
          severity: 'error',
          message: `"${source.name}" targets ${c.target} but is not attached to an item`,
          statPath: c.target,
          sources: [source],
        })
        return
      }
      const list = outputs.itemSelf.get(instance.self.itemId) ?? []
      list.push(contribution)
      outputs.itemSelf.set(instance.self.itemId, list)
      return
    }
    resolver.add(contribution)
  }
  const flag = (path: string, condition?: Predicate) => {
    resolver.declare(path, 'boolean')
    contribute({ target: path, op: 'replace', value: true, condition })
  }
  const addProficiency = (set: keyof ProficiencySets, id: string) => {
    const list = proficiencies[set].get(id)
    if (list) list.push(source)
    else proficiencies[set].set(id, [source])
  }

  switch (effect.type) {
    case 'abilityScore.bonus':
      contribute({
        target: `ability.${effect.ability}.score`,
        op: 'add',
        value: effect.value,
        condition: effect.condition,
      })
      return
    case 'abilityScore.atLeast':
      contribute({
        target: `ability.${effect.ability}.score`,
        op: 'atLeast',
        value: effect.value,
        condition: effect.condition,
      })
      return
    case 'abilityScore.maxIncrease':
      contribute({
        target: `ability.${effect.ability}.max`,
        op: 'add',
        value: effect.value,
        condition: effect.condition,
      })
      return
    case 'proficiency.grant': {
      const level = PROFICIENCY_LEVEL[effect.level]
      switch (effect.kind) {
        case 'skill':
          if (!(SKILLS as readonly string[]).includes(effect.target)) {
            diagnostic({
              code: 'UNSUPPORTED_EFFECT',
              severity: 'error',
              message: `"${source.name}" grants proficiency in unknown skill "${effect.target}"`,
              sources: [source],
            })
            return
          }
          contribute({
            target: `skill.${effect.target}.proficiency`,
            op: 'atLeast',
            value: level,
            condition: effect.condition,
          })
          return
        case 'save':
          contribute({
            target: `save.${effect.target}.proficiency`,
            op: 'atLeast',
            value: Math.min(level, 1),
            condition: effect.condition,
          })
          return
        case 'armor':
          addProficiency('armor', effect.target)
          return
        case 'weapon':
          addProficiency('weapons', effect.target)
          return
        case 'tool':
          addProficiency('tools', effect.target)
          return
        case 'language':
          addProficiency('languages', effect.target)
          return
      }
      return
    }
    case 'bonus':
      contribute({
        target: effect.target,
        op: 'add',
        value: value(effect.value),
        stackKey: effect.stackKey,
        condition: effect.condition,
      })
      return
    case 'set':
      contribute({
        target: effect.target,
        op: 'replace',
        value: value(effect.value),
        priority: effect.priority,
        condition: effect.condition,
      })
      return
    case 'atLeast':
      contribute({
        target: effect.target,
        op: 'atLeast',
        value: value(effect.value),
        condition: effect.condition,
      })
      return
    case 'atMost':
      contribute({
        target: effect.target,
        op: 'atMost',
        value: value(effect.value),
        condition: effect.condition,
      })
      return
    case 'multiply':
      contribute({
        target: effect.target,
        op: 'multiply',
        value: effect.value,
        condition: effect.condition,
      })
      return
    case 'replaceFinal':
      contribute({
        target: effect.target,
        op: 'replaceFinal',
        value: value(effect.value),
        priority: effect.priority,
        condition: effect.condition,
      })
      return
    case 'ac.formula':
      contribute({
        target: 'ac.base',
        op: 'formula',
        value: { formula: effect.formula },
        label: effect.label,
        condition: effect.condition,
      })
      return
    case 'advantage':
      flag(`roll.advantage.${effect.on}`, effect.condition)
      return
    case 'disadvantage':
      flag(`roll.disadvantage.${effect.on}`, effect.condition)
      return
    case 'damage.resistance':
    case 'damage.immunity':
    case 'damage.vulnerability': {
      const kind = effect.type.slice('damage.'.length) as DefenseView['kind']
      const defense: DefenseView = { kind, damageType: effect.damageType, source }
      if (effect.condition) defense.condition = effect.condition
      outputs.defenses.push(defense)
      if (!effect.condition) flag(`defense.${kind}.${effect.damageType}`)
      return
    }
    case 'condition.immunity':
      outputs.conditionImmunities.push({ condition: effect.condition_, source })
      flag(`defense.conditionImmunity.${effect.condition_}`, effect.condition)
      return
    case 'sense.grant':
      contribute({
        target: `sense.${effect.sense}`,
        op: 'atLeast',
        value: effect.range,
        condition: effect.condition,
      })
      return
    case 'speed.set':
      contribute({
        target: `speed.${effect.mode}`,
        op: 'replace',
        value: value(effect.value),
        priority: effect.priority,
        condition: effect.condition,
      })
      return
    case 'speed.bonus':
      contribute({
        target: `speed.${effect.mode}`,
        op: 'add',
        value: value(effect.value),
        stackKey: effect.stackKey,
        condition: effect.condition,
      })
      return
    case 'size.set':
      resolver.declare('size', 'string')
      contribute({ target: 'size', op: 'replace', value: effect.size, condition: effect.condition })
      return
    case 'language.grant':
      addProficiency('languages', effect.language)
      return
    case 'attack.extra':
      contribute({
        target: 'attacks.perAction',
        op: 'add',
        value: effect.count,
        stackKey: 'extra-attack',
        condition: effect.condition,
      })
      return
    case 'crit.range':
      contribute({
        target: 'crit.range',
        op: 'atMost',
        value: effect.min,
        condition: effect.condition,
      })
      return
    case 'weapon.property.grant': {
      const grant: WeaponPropertyGrant = { property: effect.property, source }
      if (effect.condition) grant.condition = effect.condition
      outputs.weaponPropertyGrants.push(grant)
      return
    }
    case 'hp.bonusPerLevel':
      contribute({
        target: 'hp.perLevel',
        op: 'add',
        value: effect.value,
        condition: effect.condition,
      })
      return
    case 'resource.define': {
      const id = effect.resource.id
      if (outputs.resources.has(id)) {
        diagnostic({
          code: 'CONFLICTING_REPLACE',
          severity: 'warning',
          message: `resource "${id}" is defined more than once; the definition from "${source.name}" is used`,
          statPath: `resource.${id}.max`,
          sources: [outputs.resources.get(id)!.source, source],
        })
      }
      const instanceDefinition: ResourceDefinitionInstance = { definition: effect.resource, source }
      if (effect.condition) instanceDefinition.condition = effect.condition
      outputs.resources.set(id, instanceDefinition)
      contribute({
        target: `resource.${id}.max`,
        op: 'base',
        value: value(effect.resource.max),
        condition: effect.condition,
      })
      return
    }
    // Computed by the spellcasting module from the deferred list: slots, DC and attack bonus,
    // bonus slots, and the list of granted spells.
    case 'spellcasting.grant':
    case 'spellSlots.bonus':
      outputs.deferred.push(instance)
      return
    case 'spell.grant':
      outputs.deferred.push(instance)
      // Honest about what is and is not automated (rule 7): the grant is listed with its uses or
      // charges, but casting it from the sheet is a manual step until spell actions exist.
      diagnostic({
        code: 'PARTIAL_AUTOMATION',
        severity: 'info',
        message: `"${source.name}": grants ${effect.spell}; it is listed under granted spells, but casting it from the sheet is not automated yet`,
        sources: [source],
      })
      return
    case 'action.grant':
      outputs.actionGrants.push(instance)
      return
    case 'manual':
    case 'feature.grant':
    case 'toggle.define':
    case 'hook':
      return
  }
}
