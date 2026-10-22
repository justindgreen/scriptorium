import type { Ability, Predicate } from '@scriptorium/content-schema'
import type { ActionTemplate, BreakdownLine, DamageLine, StatScalar } from '../types.js'
import { isProficientWithWeapon } from './base.js'
import type { EffectOutputs } from './effects.js'
import { FormulaError, evaluateNumeric, substituteVariables, type FormulaScope } from './formula.js'
import type { Grants, ItemSelf } from './grants.js'
import { evaluateStaticPredicate, type PredicateEnv } from './predicates.js'
import type { Contribution, StatResolver } from './resolver.js'

export type TemplateContext = {
  grants: Grants
  outputs: EffectOutputs
  resolver: StatResolver
  predicateEnv: PredicateEnv
  scope: FormulaScope
}

function signed(n: number): string {
  return n >= 0 ? `+ ${n}` : `- ${Math.abs(n)}`
}

function damageText(dice: string | null, bonus: number, type: string): string {
  if (dice === null) return `${bonus} ${type}`
  if (bonus === 0) return `${dice} ${type}`
  return `${dice} ${signed(bonus)} ${type}`
}

/** Display lines for attacks and granted actions, with symbolic dice (docs/RULES_ENGINE.md §2). */
export function buildActionTemplates(ctx: TemplateContext): ActionTemplate[] {
  const templates: ActionTemplate[] = []
  const { grants, resolver } = ctx
  const engine = grants.engineSource
  const pb = resolver.lookup.number('proficiencyBonus')
  const mod = (ability: Ability) => resolver.lookup.number(`ability.${ability}.mod`)

  const statLines = (path: string): BreakdownLine[] =>
    resolver.resolve(path).breakdown.filter((line) => line.applied && line.value !== 0)

  for (const weapon of grants.weapons) {
    if (!weapon.active) continue
    const data = weapon.data
    const properties: string[] = [...data.properties]
    for (const grant of ctx.outputs.weaponPropertyGrants) {
      if (properties.includes(grant.property)) continue
      if (grant.condition && !ctx.predicateEnv.lookup) continue
      if (
        !grant.condition ||
        evaluateStaticPredicate(
          grant.condition,
          ctx.predicateEnv,
          grant.source,
          selfOf(weapon.item.id, grants),
        )
      ) {
        properties.push(grant.property)
      }
    }
    const attackType: 'melee' | 'ranged' = data.range
    let ability: Ability = attackType === 'ranged' ? 'dex' : 'str'
    if (properties.includes('finesse') && mod('dex') > mod('str')) ability = 'dex'
    const proficient = isProficientWithWeapon(
      grants.proficiencies,
      weapon.entry.uid,
      weapon.entry.slug,
      data.category,
    )
    const self = selfOf(weapon.item.id, grants)
    const selfAttack = evaluateSelf(ctx, weapon.item.id, 'attack.weapon.self', self)
    const selfDamage = evaluateSelf(ctx, weapon.item.id, 'damage.weapon.self', self)

    const attackBreakdown: BreakdownLine[] = [
      {
        source: engine,
        op: 'add',
        value: mod(ability),
        label: `${ability.toUpperCase()} modifier`,
        applied: true,
      },
      {
        source: engine,
        op: 'add',
        value: proficient ? pb : 0,
        label: proficient ? 'Proficiency bonus' : 'Not proficient',
        applied: proficient,
      },
      ...statLines(`attack.${attackType}`),
      ...selfAttack.lines,
    ]
    const attackBonus =
      mod(ability) +
      (proficient ? pb : 0) +
      resolver.lookup.number(`attack.${attackType}`) +
      selfAttack.total
    const damageBonus =
      mod(ability) + resolver.lookup.number(`damage.${attackType}`) + selfDamage.total
    const damage: DamageLine[] = []
    if (data.damage) {
      damage.push({
        dice: data.damage.dice,
        bonus: damageBonus,
        damageType: data.damage.damageType,
        text: damageText(data.damage.dice, damageBonus, data.damage.damageType),
      })
      if (data.versatileDamage) {
        damage.push({
          dice: data.versatileDamage,
          bonus: damageBonus,
          damageType: data.damage.damageType,
          text: damageText(data.versatileDamage, damageBonus, data.damage.damageType),
          label: 'two-handed',
        })
      }
    }
    const template: ActionTemplate = {
      id: `weapon:${weapon.item.id}`,
      name: weapon.entry.name,
      kind: 'weapon',
      actionType: 'action',
      itemId: weapon.item.id,
      attackType,
      attack: { bonus: attackBonus, breakdown: attackBreakdown, proficient, ability },
      damage,
      riders: ridersFor(ctx, weapon.item.id),
      properties,
      source: weapon.source,
    }
    if (data.range === 'ranged' && data.normalRange !== undefined) {
      template.range = {
        normal: data.normalRange,
        ...(data.longRange !== undefined ? { long: data.longRange } : {}),
      }
    } else if (properties.includes('thrown') && data.throwNormalRange !== undefined) {
      template.range = {
        normal: data.throwNormalRange,
        ...(data.throwLongRange !== undefined ? { long: data.throwLongRange } : {}),
      }
    }
    if (properties.includes('reach')) template.reach = 10
    templates.push(template)
  }

  // Unarmed strike (2014: 1 + STR modifier bludgeoning; everyone is proficient).
  {
    const strMod = mod('str')
    const attackBonus =
      strMod +
      pb +
      resolver.lookup.number('attack.unarmed') +
      resolver.lookup.number('attack.melee')
    const damageBonus =
      1 + strMod + resolver.lookup.number('damage.unarmed') + resolver.lookup.number('damage.melee')
    templates.push({
      id: 'unarmed',
      name: 'Unarmed Strike',
      kind: 'unarmed',
      actionType: 'action',
      attackType: 'melee',
      attack: {
        bonus: attackBonus,
        breakdown: [
          { source: engine, op: 'add', value: strMod, label: 'STR modifier', applied: true },
          { source: engine, op: 'add', value: pb, label: 'Proficiency bonus', applied: true },
          ...statLines('attack.unarmed'),
          ...statLines('attack.melee'),
        ],
        proficient: true,
        ability: 'str',
      },
      damage: [
        {
          dice: null,
          bonus: Math.max(1, damageBonus),
          damageType: 'bludgeoning',
          text: `${Math.max(1, damageBonus)} bludgeoning`,
        },
      ],
      riders: [],
      properties: [],
      source: engine,
    })
  }

  // Granted actions (class features, items, spells cast through items).
  for (const instance of ctx.outputs.actionGrants) {
    const effect = instance.effect
    if (effect.type !== 'action.grant') continue
    if (
      effect.condition &&
      !evaluateStaticPredicate(effect.condition, ctx.predicateEnv, instance.source, instance.self)
    )
      continue
    const template: ActionTemplate = {
      id: `action:${instance.source.path}/${slugify(effect.name)}`,
      name: effect.name,
      kind: 'action',
      actionType: effect.actionType,
      damage: [],
      riders: [],
      properties: [],
      source: instance.source,
    }
    if (instance.self) template.itemId = instance.self.itemId
    if (effect.attack) {
      const kind = effect.attack.kind
      const breakdown: BreakdownLine[] = []
      let bonus = 0
      if (effect.attack.ability) {
        const m = mod(effect.attack.ability)
        bonus += m + pb
        breakdown.push({
          source: engine,
          op: 'add',
          value: m,
          label: `${effect.attack.ability.toUpperCase()} modifier`,
          applied: true,
        })
        breakdown.push({
          source: engine,
          op: 'add',
          value: pb,
          label: 'Proficiency bonus',
          applied: true,
        })
      }
      if (effect.attack.bonus !== undefined) {
        const extra = safeNumeric(effect.attack.bonus, ctx.scope)
        if (extra !== null) {
          bonus += extra
          breakdown.push({
            source: instance.source,
            op: 'add',
            value: extra,
            label: String(effect.attack.bonus),
            applied: true,
          })
        }
      }
      bonus += resolver.lookup.number(`attack.${kind}`)
      breakdown.push(...statLines(`attack.${kind}`))
      template.attackType = kind
      template.attack = {
        bonus,
        breakdown,
        proficient: true,
        ...(effect.attack.ability ? { ability: effect.attack.ability } : {}),
      }
      if (effect.attack.reach !== undefined) template.reach = effect.attack.reach
      if (effect.attack.range) template.range = effect.attack.range
    }
    for (const line of effect.damage ?? []) {
      const text = safeSubstitute(line.formula, ctx.scope)
      template.damage.push({
        dice: text,
        bonus: 0,
        damageType: line.damageType,
        text: `${text} ${line.damageType}`,
      })
    }
    if (effect.save) {
      const dc =
        effect.save.dc === 'spell' ? 'spell' : (safeNumeric(effect.save.dc, ctx.scope) ?? 'spell')
      template.save = { ability: effect.save.ability, dc, onSuccess: effect.save.onSuccess }
    }
    if (effect.healing) template.healing = safeSubstitute(effect.healing, ctx.scope)
    if (effect.cost) template.cost = effect.cost
    templates.push(template)
  }

  return templates
}

function selfOf(itemId: string, grants: Grants): ItemSelf | undefined {
  const weapon = grants.weapons.find((w) => w.item.id === itemId)
  if (!weapon) return undefined
  return {
    uid: weapon.entry.uid,
    itemId,
    itemName: weapon.entry.name,
    equipped: weapon.item.equipped,
    attuned: weapon.item.attuned,
  }
}

/** Sums an item's own `attack.weapon.self` / `damage.weapon.self` contributions. */
function evaluateSelf(
  ctx: TemplateContext,
  itemId: string,
  target: string,
  self: ItemSelf | undefined,
): { total: number; lines: BreakdownLine[] } {
  const lines: BreakdownLine[] = []
  let total = 0
  let replaced: number | undefined
  const contributions = (ctx.outputs.itemSelf.get(itemId) ?? []).filter((c) => c.target === target)
  for (const c of contributions) {
    const line = evaluateContribution(ctx, c, self)
    lines.push(line)
    if (!line.applied || typeof line.value !== 'number') continue
    if (c.op === 'add') total += line.value
    else if (c.op === 'replace' || c.op === 'replaceFinal') replaced = line.value
  }
  return { total: replaced ?? total, lines }
}

function evaluateContribution(
  ctx: TemplateContext,
  c: Contribution,
  self: ItemSelf | undefined,
): BreakdownLine {
  const line: BreakdownLine = {
    source: c.source,
    op: c.op,
    value: null,
    applied: false,
    ...(c.note ? { note: c.note } : {}),
  }
  if (c.condition && !evaluateStaticPredicate(c.condition, ctx.predicateEnv, c.source, self)) {
    line.reason = 'condition-false'
    return line
  }
  let value: StatScalar | null
  if (typeof c.value === 'object' && c.value !== null && !Array.isArray(c.value)) {
    if ('formula' in c.value) {
      value = safeNumeric(c.value.formula, ctx.scope)
      line.label = c.value.formula
    } else value = c.value.compute(ctx.resolver.lookup)
  } else value = c.value
  if (value === null) {
    line.reason = 'formula-error'
    return line
  }
  line.value = value
  line.applied = true
  return line
}

function ridersFor(ctx: TemplateContext, itemId: string): ActionTemplate['riders'] {
  const riders: ActionTemplate['riders'] = []
  for (const instance of ctx.outputs.actionEffects) {
    if (instance.self?.itemId !== itemId) continue
    const effect = instance.effect
    if (effect.type === 'action.damageAdd') {
      const text = `${effect.label ?? instance.source.name}: +${safeSubstitute(effect.formula, ctx.scope)} ${effect.damageType}${effect.condition ? ` (${describeCondition(effect.condition)})` : ''}`
      riders.push({ text, source: instance.source })
    } else if (effect.type === 'action.onHit' || effect.type === 'action.onCrit') {
      riders.push({ text: effect.text, source: instance.source })
    }
  }
  return riders
}

function describeCondition(predicate: Predicate): string {
  if ('all' in predicate) return predicate.all.map(describeCondition).join(' and ')
  if ('any' in predicate) return predicate.any.map(describeCondition).join(' or ')
  if ('not' in predicate) return `not ${describeCondition(predicate.not)}`
  switch (predicate.leaf) {
    case 'ctx.targetType':
      return `against ${predicate.types.join('/')}`
    case 'ctx.targetSize':
      return `against ${predicate.sizes.join('/')} creatures`
    case 'ctx.targetHasCondition':
      return `target is ${predicate.condition}`
    case 'ctx.hasAdvantage':
      return 'with advantage'
    case 'ctx.allyAdjacent':
      return 'ally within 5 feet of the target'
    case 'ctx.firstAttackThisTurn':
      return 'first attack this turn'
    case 'ctx.attackType':
      return `${predicate.type} attacks`
    case 'ctx.weaponProperty':
      return `${predicate.property} weapons`
    default:
      return predicate.leaf.replace(/^ctx\./, '')
  }
}

function safeNumeric(formula: string | number, scope: FormulaScope): number | null {
  try {
    return evaluateNumeric(formula, scope)
  } catch (error) {
    if (error instanceof FormulaError) return null
    throw error
  }
}

function safeSubstitute(formula: string, scope: FormulaScope): string {
  try {
    return substituteVariables(formula, scope)
  } catch (error) {
    if (error instanceof FormulaError) return formula
    throw error
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
