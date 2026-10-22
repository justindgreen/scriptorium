import { ABILITIES, type Ability } from '@scriptorium/content-schema'
import type { CharacterAggregate, Diagnostic, RulesetProfile, SourceRef } from '../types.js'
import type { Grants, ProficiencySets } from './grants.js'
import type { Contribution, StatResolver } from './resolver.js'

const SIZE_MULTIPLIER: Record<string, number> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 4,
  gargantuan: 8,
}

const SENSES = ['darkvision', 'blindsight', 'tremorsense', 'truesight'] as const
const SPEEDS = ['walk', 'fly', 'swim', 'climb', 'burrow'] as const
const HIT_DICE = ['d4', 'd6', 'd8', 'd10', 'd12'] as const

export type BaseContext = {
  aggregate: CharacterAggregate
  grants: Grants
  ruleset: RulesetProfile
  resolver: StatResolver
  diagnostic: (d: Diagnostic) => void
}

/**
 * The engine's own contributions: every stat family's base value and the formulas that derive
 * one stat from another (docs/RULES_ENGINE.md §2, §3). Runs after the effect pass so the
 * proficiency sets are complete; registration order never affects results.
 */
export function addEngineContributions(ctx: BaseContext): void {
  const { aggregate, grants, ruleset, resolver } = ctx
  const engine = grants.engineSource
  const rulesetSource = grants.rulesetSource
  let index = 0
  const add = (c: Omit<Contribution, 'index' | 'source'> & { source?: SourceRef }) => {
    resolver.add({ ...c, source: c.source ?? engine, index: index++ })
  }
  const skillAbility = new Map<string, Ability>()
  for (const skill of ruleset.config.skills) skillAbility.set(skill.id, skill.ability)
  const level = grants.facts.level

  // Abilities
  for (const ability of ABILITIES) {
    add({
      target: `ability.${ability}.score`,
      op: 'base',
      value: aggregate.definition.baseAbilities[ability],
      label: 'Base score',
    })
    add({
      target: `ability.${ability}.max`,
      op: 'base',
      value: ruleset.abilityScoreCap,
      label: 'Ability score cap',
      source: rulesetSource,
    })
    add({
      target: `ability.${ability}.score`,
      op: 'atMost',
      value: { compute: (l) => l.number(`ability.${ability}.max`), label: 'Score cap' },
    })
    add({
      target: `ability.${ability}.mod`,
      op: 'base',
      value: {
        compute: (l) => Math.floor((l.number(`ability.${ability}.score`) - 10) / 2),
        label: '(score - 10) / 2',
      },
    })
    add({
      target: `check.${ability}`,
      op: 'base',
      value: { compute: (l) => l.number(`ability.${ability}.mod`), label: 'Ability modifier' },
    })
    add({ target: `save.${ability}.proficiency`, op: 'base', value: 0 })
    add({
      target: `save.${ability}.bonus`,
      op: 'base',
      value: {
        compute: (l) =>
          l.number(`ability.${ability}.mod`) +
          Math.floor(l.number(`save.${ability}.proficiency`) * l.number('proficiencyBonus')),
        label: 'Ability modifier + proficiency',
      },
    })
  }

  add({
    target: 'proficiencyBonus',
    op: 'base',
    value: ruleset.proficiencyBonus(level),
    label: `Level ${level}`,
    source: rulesetSource,
  })

  // Skills and passives
  for (const [skill, ability] of skillAbility) {
    add({ target: `skill.${skill}.proficiency`, op: 'base', value: 0 })
    add({
      target: `skill.${skill}.bonus`,
      op: 'base',
      value: {
        compute: (l) =>
          l.number(`ability.${ability}.mod`) +
          Math.floor(l.number(`skill.${skill}.proficiency`) * l.number('proficiencyBonus')),
        label: `${ability.toUpperCase()} modifier + proficiency`,
      },
    })
    resolver.declare(`roll.advantage.check.${skill}`, 'boolean')
    resolver.declare(`roll.disadvantage.check.${skill}`, 'boolean')
    add({
      target: `passive.${skill}`,
      op: 'base',
      value: {
        compute: (l) => {
          const advantage = l.boolean(`roll.advantage.check.${skill}`)
          const disadvantage = l.boolean(`roll.disadvantage.check.${skill}`)
          return (
            10 +
            l.number(`skill.${skill}.bonus`) +
            (advantage && !disadvantage ? 5 : 0) -
            (disadvantage && !advantage ? 5 : 0)
          )
        },
        label: '10 + skill bonus (±5 with advantage or disadvantage)',
      },
    })
  }

  add({
    target: 'initiative.bonus',
    op: 'base',
    value: { compute: (l) => l.number('ability.dex.mod'), label: 'DEX modifier' },
  })

  // Armor class: a formula group plus a bonus pool.
  resolver.declare('ac.base', 'number', 'userChoice')
  add({ target: 'ac.base', op: 'formula', value: { formula: '10 + DEX' }, label: 'Unarmored' })
  if (grants.armor) {
    const armor = grants.armor
    const data = armor.data
    add({
      target: 'ac.base',
      op: 'formula',
      source: armor.source,
      label: armor.entry.name,
      value: {
        compute: (l) => {
          const dex = l.number('ability.dex.mod')
          const capped = data.maxDexBonus === undefined ? dex : Math.min(dex, data.maxDexBonus)
          return data.baseAc + (data.addDexModifier ? capped : 0)
        },
        label: data.addDexModifier
          ? `${data.baseAc} + DEX${data.maxDexBonus !== undefined ? ` (max ${data.maxDexBonus})` : ''}`
          : `${data.baseAc}`,
      },
    })
    if (data.stealthDisadvantage) {
      resolver.declare('roll.disadvantage.check.stealth', 'boolean')
      add({
        target: 'roll.disadvantage.check.stealth',
        op: 'replace',
        value: true,
        source: armor.source,
        note: 'Armor imposes disadvantage on Stealth',
      })
    }
    if (data.strengthMinimum !== undefined) {
      add({
        target: 'speed.walk',
        op: 'add',
        value: -10,
        source: armor.source,
        note: `Strength ${data.strengthMinimum} required`,
        condition: { not: { leaf: 'abilityScore', ability: 'str', gte: data.strengthMinimum } },
      })
    }
  }
  // A shield's +2 is an effect on the shield item (content), not an engine rule.
  add({ target: 'ac.bonus', op: 'base', value: 0 })
  add({
    target: 'ac.total',
    op: 'base',
    value: {
      compute: (l) => l.number('ac.base') + l.number('ac.bonus'),
      label: 'ac.base + ac.bonus',
    },
  })

  // Armor proficiency (2014: disadvantage on STR/DEX checks, saves and attacks; no spellcasting).
  const worn = [
    ...(grants.armor ? [{ ...grants.armor, category: grants.armor.data.category }] : []),
    ...(grants.shield ? [{ ...grants.shield, category: 'shield' }] : []),
  ]
  for (const piece of worn) {
    if (
      isProficientWithArmor(grants.proficiencies, piece.entry.uid, piece.entry.slug, piece.category)
    )
      continue
    ctx.diagnostic({
      code: 'PROFICIENCY_VIOLATION',
      severity: 'warning',
      message: `Not proficient with ${piece.entry.name}: disadvantage on Strength and Dexterity checks, saving throws and attack rolls, and spells cannot be cast`,
      sources: [piece.source],
    })
    for (const key of [
      'check.str',
      'check.dex',
      'save.str',
      'save.dex',
      'attack.melee',
      'attack.ranged',
      'attack.spell',
    ]) {
      resolver.declare(`roll.disadvantage.${key}`, 'boolean')
      add({
        target: `roll.disadvantage.${key}`,
        op: 'replace',
        value: true,
        source: piece.source,
        note: 'Not proficient with this armor',
      })
    }
  }

  // Speeds, size, carrying capacity, senses
  add({
    target: 'speed.walk',
    op: 'base',
    value: grants.speciesSpeed ?? 30,
    source: grants.speciesSource ?? engine,
    label: grants.speciesSource ? 'Species speed' : 'Default speed',
  })
  for (const mode of SPEEDS)
    if (mode !== 'walk') add({ target: `speed.${mode}`, op: 'base', value: 0 })
  resolver.declare('size', 'string')
  add({
    target: 'size',
    op: 'base',
    value: grants.speciesSize ?? 'medium',
    label: grants.speciesSize ? 'Species size' : 'Default size',
  })
  add({
    target: 'carry.capacity',
    op: 'base',
    value: {
      compute: (l) => {
        const size = String(l.value('size'))
        return (
          l.number('ability.str.score') *
          ruleset.config.carryingCapacityMultiplier *
          (SIZE_MULTIPLIER[size] ?? 1)
        )
      },
      label: `STR score × ${ruleset.config.carryingCapacityMultiplier} × size`,
    },
  })
  for (const sense of SENSES) add({ target: `sense.${sense}`, op: 'base', value: 0 })

  // Hit points and hit dice
  add({
    target: 'hp.perLevel',
    op: 'base',
    value: { compute: (l) => l.number('ability.con.mod'), label: 'CON modifier' },
  })
  const dieCounts = new Map<string, number>()
  for (const cls of grants.classes)
    dieCounts.set(cls.entry.data.hitDie, (dieCounts.get(cls.entry.data.hitDie) ?? 0) + cls.level)
  for (const die of HIT_DICE)
    add({ target: `hitDice.${die}.max`, op: 'base', value: dieCounts.get(die) ?? 0 })
  let reportedMissingRolls = false
  add({
    target: 'hp.max',
    op: 'base',
    label:
      aggregate.definition.hpMode === 'rolled'
        ? 'Rolled hit dice + CON per level'
        : 'Hit dice (first level maxed, then average) + CON per level',
    value: {
      compute: (l) => {
        const perLevel = l.number('hp.perLevel')
        let total = 0
        let overall = 0
        let missing = 0
        for (const cls of [...grants.classes].sort((a, b) => a.order - b.order)) {
          const die = Number(cls.entry.data.hitDie.slice(1))
          const average = die / 2 + 1
          for (let i = 0; i < cls.level; i += 1) {
            overall += 1
            let roll = average
            if (overall === 1) roll = die
            else if (aggregate.definition.hpMode === 'rolled') {
              const stored = cls.hitDiceRolls[i]
              if (stored === undefined) missing += 1
              else roll = stored
            }
            total += Math.max(1, roll + perLevel)
          }
        }
        if (missing > 0 && !reportedMissingRolls) {
          reportedMissingRolls = true
          ctx.diagnostic({
            code: 'HP_ROLL_MISSING',
            severity: 'warning',
            message: `${missing} hit point roll${missing === 1 ? ' is' : 's are'} missing; the average was used`,
            statPath: 'hp.max',
            sources: [engine],
          })
        }
        return total
      },
    },
  })

  // Attack and damage pools, criticals, attacks per action
  for (const kind of ['melee', 'ranged', 'spell', 'unarmed'] as const)
    add({ target: `attack.${kind}`, op: 'base', value: 0 })
  for (const kind of ['melee', 'ranged', 'unarmed'] as const)
    add({ target: `damage.${kind}`, op: 'base', value: 0 })
  add({ target: 'crit.range', op: 'base', value: 20 })
  add({ target: 'attacks.perAction', op: 'base', value: 1 })
}

/** Armor proficiency ids used by SRD class data: `all-armor`, `light-armor`, `shields`, or an item. */
export function isProficientWithArmor(
  sets: ProficiencySets,
  uid: string,
  slug: string,
  category: string,
): boolean {
  const armor = sets.armor
  if (armor.has(uid) || armor.has(slug)) return true
  if (category === 'shield') return armor.has('shields') || armor.has('shield')
  return armor.has('all-armor') || armor.has(`${category}-armor`) || armor.has(category)
}

/** Weapon proficiency ids: `simple-weapons`, `martial-weapons`, `all-weapons`, or an item (singular or plural slug). */
export function isProficientWithWeapon(
  sets: ProficiencySets,
  uid: string,
  slug: string,
  category: 'simple' | 'martial',
): boolean {
  const weapons = sets.weapons
  return (
    weapons.has(uid) ||
    weapons.has(slug) ||
    weapons.has(`${slug}s`) ||
    weapons.has(`${slug}es`) ||
    weapons.has('all-weapons') ||
    weapons.has(`${category}-weapons`) ||
    weapons.has(category)
  )
}
