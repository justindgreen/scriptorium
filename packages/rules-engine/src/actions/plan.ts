import { format, multiplyDice, parse, type DiceNode, type Node } from '@scriptorium/dice/ast'
import type { ActionEffect, Ability } from '@scriptorium/content-schema'
import { entryOfKind } from '../snapshot.js'
import {
  FormulaError,
  evaluateNumeric,
  substituteVariables,
  type FormulaScope,
} from '../static/formula.js'
import type {
  ActionEffectView,
  ActionTemplate,
  BreakdownLine,
  CharacterAggregate,
  ComputedSheet,
  ContentSnapshot,
  Diagnostic,
  SourceRef,
} from '../types.js'
import { evaluateActionPredicate, type ActionPredicateEnv, type WeaponFacts } from './predicates.js'
import type {
  ActionContext,
  ActionPlan,
  ActionRef,
  ActionType,
  Assumption,
  AttackType,
  CostSpec,
  DamagePacketSpec,
  PacketFlags,
  Question,
  RollMode,
} from './types.js'

const ABILITY_OF_SKILL: Record<string, Ability> = {
  acrobatics: 'dex',
  'animal-handling': 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  'sleight-of-hand': 'dex',
  stealth: 'dex',
  survival: 'wis',
}

/** Formula scope backed by a computed sheet (and class tables when a snapshot is given). */
export function scopeFromSheet(
  sheet: ComputedSheet,
  snapshot?: ContentSnapshot,
  extra: { slotLevel?: number; castingMod?: number } = {},
): FormulaScope {
  const number = (path: string) => {
    const v = sheet.stats[path]?.value
    return typeof v === 'number' ? v : 0
  }
  return {
    abilityMod: (a) => number(`ability.${a}.mod`),
    abilityScore: (a) => number(`ability.${a}.score`),
    proficiencyBonus: () => number('proficiencyBonus'),
    level: () => sheet.level,
    classLevel: (uid) => sheet.facts.classLevels[uid] ?? 0,
    castingMod: () => {
      if (extra.castingMod !== undefined) return extra.castingMod
      const primary = sheet.spellcasting?.sources.find((s) => s.id === sheet.spellcasting?.primary)
      if (!primary)
        throw new FormulaError(
          'castingMod is not available: the character has no spellcasting',
          'UNKNOWN_VARIABLE',
        )
      return primary.mod
    },
    slotLevel: () => {
      if (extra.slotLevel === undefined)
        throw new FormulaError(
          'slotLevel is only available when casting a spell',
          'UNKNOWN_VARIABLE',
        )
      return extra.slotLevel
    },
    table: (name, level) => {
      if (!snapshot)
        throw new FormulaError(`table "${name}" needs the content snapshot`, 'FORMULA_ERROR')
      for (const uid of Object.keys(sheet.facts.classLevels)) {
        const cls = entryOfKind(snapshot, uid, 'class')
        if (!cls || !cls.data.levels.some((r) => name in r.columns)) continue
        const rows = cls.data.levels
        const clamped = Math.max(1, Math.min(Math.floor(level), rows.length))
        const raw = (rows.find((r) => r.level === clamped) ?? rows[clamped - 1])?.columns[name]
        const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? 0))
        if (Number.isNaN(n))
          throw new FormulaError(`table "${name}" is not numeric`, 'FORMULA_ERROR')
        return n
      }
      throw new FormulaError(`unknown table "${name}"`, 'FORMULA_ERROR')
    },
  }
}

type Base = {
  name: string
  actionType: ActionType
  attackType?: AttackType
  attack?: { bonus: number; breakdown: BreakdownLine[]; proficient: boolean; ability?: Ability }
  save?: ActionPlan['save']
  packets: Array<{
    id: string
    label: string
    formula: string
    damageType: string
    source: SourceRef
    weapon: boolean
  }>
  healing?: string
  costs: CostSpec[]
  weapon?: WeaponFacts
  itemId?: string
  concentration?: boolean
  source: SourceRef
  self?: { equipped: boolean; attuned: boolean }
  flags: PacketFlags
}

/**
 * Builds the plan for one action from the sheet, the aggregate's runtime state and the
 * situation (docs/RULES_ENGINE.md §6). Pure: nothing is rolled or spent here.
 */
export function planAction(
  sheet: ComputedSheet,
  aggregate: CharacterAggregate,
  ref: ActionRef,
  ctx: ActionContext = {},
  snapshot?: ContentSnapshot,
): ActionPlan {
  const diagnostics: Diagnostic[] = []
  const questions: Question[] = []
  const assumptions: Assumption[] = []
  const answers: Record<string, unknown> = {
    ...aggregate.state.assumptions,
    ...ctx.options?.answers,
  }
  const situation = ctx.situation ?? {}
  const combat = aggregate.state.combat

  const ask: ActionPredicateEnv['ask'] = (question, fallback) => {
    const given = ctx.options?.answers?.[question.id]
    const value = given !== undefined ? given : (answers[question.id] ?? fallback)
    if (given === undefined) {
      const existing = questions.find((q) => q.id === question.id)
      if (existing) existing.affects = [...new Set([...existing.affects, ...question.affects])]
      else questions.push({ ...question, assumed: value })
      if (!assumptions.some((a) => a.id === question.id)) {
        assumptions.push({
          id: question.id,
          value,
          text: `${question.text} Assumed: ${String(value ?? 'unknown')}.`,
        })
      }
    }
    return value
  }

  const blockedPlan = (name: string, actionType: ActionType, reason: string): ActionPlan => ({
    ref,
    name,
    actionType,
    economy: { kind: actionType, available: false, reason },
    damage: [],
    excluded: [],
    costs: [],
    riders: [],
    questions,
    assumptions,
    oncePerTurnKeys: [],
    diagnostics,
    blocked: reason,
  })

  // 1. The base of the action.
  const base = resolveBase(sheet, aggregate, ref, snapshot, diagnostics)
  if ('blocked' in base) return blockedPlan(base.name, base.actionType, base.blocked)

  const scope = scopeFromSheet(sheet, snapshot, {
    ...(ref.kind === 'spell' && base.slotLevel !== undefined ? { slotLevel: base.slotLevel } : {}),
    ...(base.castingMod !== undefined ? { castingMod: base.castingMod } : {}),
  })
  const env: ActionPredicateEnv = {
    facts: sheet.facts,
    stats: sheet.stats,
    combat,
    ...(base.attackType ? { attackType: base.attackType } : {}),
    ...(base.weapon ? { weapon: base.weapon } : {}),
    ...(ctx.target ? { target: ctx.target } : {}),
    situation,
    ...(ref.kind === 'spell' && base.slotLevel !== undefined ? { slotLevel: base.slotLevel } : {}),
    ...(ref.kind === 'spell' ? { spellUid: ref.spellUid } : {}),
    hasAdvantage: null,
    ...(base.self ? { self: base.self } : {}),
    ask,
    scopeViolation: (source, leaf) =>
      diagnostics.push({
        code: 'SCOPE_VIOLATION',
        severity: 'error',
        message: `"${source.name}" uses the predicate "${leaf}" where it cannot be decided; treated as false`,
        sources: [source],
      }),
  }

  const applicable = sheet.actionEffects.filter((view) => appliesTo(view, ref, base))

  // 2. Advantage and disadvantage settle the roll mode before anything depends on it.
  const advantageSources = [...(situation.advantageSources ?? [])]
  const disadvantageSources = [...(situation.disadvantageSources ?? [])]
  if (situation.hidden) advantageSources.push('hidden')
  if (situation.range === 'long') disadvantageSources.push('long range')
  if (base.attackType && base.attack) {
    const flagKey = `roll.${'advantage'}.attack.${base.attackType}`
    if (sheet.stats[flagKey]?.value === true)
      advantageSources.push(
        sheet.stats[flagKey]!.breakdown.find((l) => l.applied)?.source.name ?? 'sheet',
      )
    const disKey = `roll.disadvantage.attack.${base.attackType}`
    if (sheet.stats[disKey]?.value === true)
      disadvantageSources.push(
        sheet.stats[disKey]!.breakdown.find((l) => l.applied)?.source.name ?? 'sheet',
      )
  }
  for (const view of applicable) {
    const effect = view.effect
    if (effect.type !== 'action.advantage' && effect.type !== 'action.disadvantage') continue
    if (
      effect.condition &&
      !evaluateActionPredicate(effect.condition, env, view.source, ['attack.mode'])
    )
      continue
    ;(effect.type === 'action.advantage' ? advantageSources : disadvantageSources).push(
      view.source.name,
    )
  }
  const mode: RollMode =
    advantageSources.length > 0 && disadvantageSources.length > 0
      ? 'normal'
      : advantageSources.length > 0
        ? 'advantage'
        : disadvantageSources.length > 0
          ? 'disadvantage'
          : 'normal'
  env.hasAdvantage = mode === 'advantage'

  // 3. Attack bonus, crit range, damage packets, rerolls, riders, costs.
  const attackAdds = new Map<string, { value: number; view: ActionEffectView }>()
  const attackLines: BreakdownLine[] = []
  let critRange = numberStat(sheet, 'crit.range') || 20
  const packets: DamagePacketSpec[] = []
  const excluded: ActionPlan['excluded'] = []
  const riders: ActionPlan['riders'] = []
  const costs: CostSpec[] = [...base.costs]
  let saveDcAdd = 0
  const rerolls: Array<{ values: number[]; once: boolean }> = []
  let replaceDie: number | undefined
  const declined = new Set(ctx.options?.declineOptional ?? [])

  const basePackets = base.packets.map((p) => ({ ...p }))

  for (const view of applicable) {
    const effect = view.effect
    if (effect.type === 'action.advantage' || effect.type === 'action.disadvantage') continue
    const id = packetId(view)
    if (effect.condition && !evaluateActionPredicate(effect.condition, env, view.source, [id]))
      continue
    switch (effect.type) {
      case 'action.attackBonus': {
        const value = numeric(effect.value, scope, view.source, diagnostics)
        if (value === null) break
        const key = effect.stackKey ?? `${view.source.path}#${id}`
        const current = attackAdds.get(key)
        if (!current || value > current.value) attackAdds.set(key, { value, view })
        break
      }
      case 'action.critRange':
        critRange = Math.min(critRange, effect.min)
        break
      case 'action.damageAdd': {
        const label = effect.label ?? view.source.name
        if (effect.oncePerTurn && combat.oncePerTurn[effect.oncePerTurn] === combat.turn.turnId) {
          excluded.push({ id, label, reason: 'already used this turn' })
          break
        }
        if (
          effect.optional &&
          (declined.has(id) || (effect.oncePerTurn && declined.has(effect.oncePerTurn)))
        ) {
          excluded.push({ id, label, reason: 'declined' })
          break
        }
        const formula = substitute(effect.formula, scope, view.source, diagnostics)
        if (formula === null) break
        const damageType =
          effect.damageType === 'weapon'
            ? (basePackets[0]?.damageType ?? 'bludgeoning')
            : effect.damageType
        const spec: DamagePacketSpec = {
          id,
          label,
          formula,
          critFormula: critical(formula),
          damageType,
          source: view.source,
          optional: effect.optional,
          flags: { ...base.flags, weapon: false },
        }
        if (effect.oncePerTurn) spec.oncePerTurnKey = effect.oncePerTurn
        packets.push(spec)
        break
      }
      case 'action.damageReplaceDie': {
        const faces = Number(effect.die.slice(1))
        replaceDie = replaceDie === undefined ? faces : Math.max(replaceDie, faces)
        break
      }
      case 'action.rerollDamageDice':
        rerolls.push({ values: effect.values, once: effect.once })
        break
      case 'action.onHit':
        riders.push({ text: effect.text, source: view.source, when: 'hit' })
        break
      case 'action.onCrit':
        riders.push({ text: effect.text, source: view.source, when: 'crit' })
        break
      case 'action.saveDC': {
        const value = numeric(effect.value, scope, view.source, diagnostics)
        if (value !== null) saveDcAdd += value
        break
      }
      case 'action.cost':
        costs.push(costSpec(effect.cost, sheet, aggregate, base.itemId))
        break
      case 'action.requiresChoice':
        riders.push({
          text: `Choose ${effect.key}: ${effect.options.join(' / ')}`,
          source: view.source,
          when: 'always',
        })
        break
    }
  }

  // Weapon packets come first; replace-die and rerolls shape their dice.
  for (const p of basePackets) {
    let formula = p.formula
    if (p.weapon) {
      if (replaceDie !== undefined) formula = withReplacedDie(formula, replaceDie)
      for (const reroll of rerolls) formula = withReroll(formula, reroll)
    }
    packets.unshift({
      id: p.id,
      label: p.label,
      formula,
      critFormula: critical(formula),
      damageType: p.damageType,
      source: p.source,
      optional: false,
      flags: { ...base.flags, weapon: p.weapon },
    })
  }
  // Keep base packets in their original order ahead of the adds.
  packets.sort((a, b) => Number(b.flags.weapon) - Number(a.flags.weapon))

  let attack: ActionPlan['attack']
  if (base.attack && base.attackType) {
    let bonus = base.attack.bonus
    attackLines.push(...base.attack.breakdown)
    for (const { value, view } of attackAdds.values()) {
      bonus += value
      attackLines.push({ source: view.source, op: 'add', value, applied: true })
    }
    attack = {
      attackType: base.attackType,
      bonus,
      breakdown: attackLines,
      mode,
      advantageSources,
      disadvantageSources,
      critRange,
      proficient: base.attack.proficient,
      ...(base.attack.ability ? { ability: base.attack.ability } : {}),
    }
  }

  const economy = economyOf(base.actionType, aggregate)
  const plan: ActionPlan = {
    ref,
    name: base.name,
    actionType: base.actionType,
    economy,
    damage: packets,
    excluded,
    costs,
    riders,
    questions,
    assumptions,
    oncePerTurnKeys: packets.flatMap((p) => (p.oncePerTurnKey ? [p.oncePerTurnKey] : [])),
    diagnostics,
  }
  if (attack) plan.attack = attack
  if (base.save) plan.save = { ...base.save, dc: base.save.dc + saveDcAdd }
  if (base.healing !== undefined) {
    const healing = substitute(base.healing, scope, base.source, diagnostics)
    if (healing !== null) plan.healing = healing
  }
  if (base.concentration) plan.concentration = true
  if ('check' in base && base.check)
    plan.check = { ...base.check, mode, advantageSources, disadvantageSources }
  const insufficient = costs.find((c) => !c.sufficient)
  if (insufficient)
    plan.blocked = `not enough ${insufficient.kind === 'slot' ? `level ${insufficient.level} spell slots` : insufficient.kind === 'pact' ? 'pact slots' : (insufficient.id ?? insufficient.kind)}`
  return plan
}

type BaseResult =
  | (Base & {
      slotLevel?: number
      castingMod?: number
      check?: { label: string; bonus: number; breakdown: BreakdownLine[] }
    })
  | { blocked: string; name: string; actionType: ActionType }

function resolveBase(
  sheet: ComputedSheet,
  aggregate: CharacterAggregate,
  ref: ActionRef,
  snapshot: ContentSnapshot | undefined,
  diagnostics: Diagnostic[],
): BaseResult {
  const engine: SourceRef = { kind: 'engine', name: 'Engine', path: 'engine', order: -2 }
  const flags = (magical: boolean, properties: string[], fromSpell = false): PacketFlags => ({
    magical: magical || properties.includes('magical'),
    silvered: properties.includes('silvered'),
    adamantine: properties.includes('adamantine'),
    fromSpell,
    weapon: true,
  })
  switch (ref.kind) {
    case 'weapon': {
      const template = sheet.actionTemplates.find(
        (t) => t.kind === 'weapon' && t.itemId === ref.itemId,
      )
      if (!template)
        return {
          blocked: 'that weapon is not equipped',
          name: 'Weapon attack',
          actionType: 'action',
        }
      const item = aggregate.inventory.find((i) => i.id === ref.itemId)
      const properties = template.properties
      const twoHanded = Boolean(ref.twoHanded) || properties.includes('two-handed')
      const line =
        twoHanded && template.damage.length > 1 ? template.damage[1]! : template.damage[0]
      const packets: Base['packets'] = line
        ? [
            {
              id: 'weapon',
              label: template.name,
              formula: damageFormula(line.dice, line.bonus),
              damageType: line.damageType,
              source: template.source,
              weapon: true,
            },
          ]
        : []
      return {
        name: template.name,
        actionType: 'action',
        attackType: template.attackType ?? 'melee',
        attack: template.attack ? { ...template.attack } : undefined,
        packets,
        costs: [],
        weapon: {
          properties,
          category: template.weaponCategory ?? 'simple',
          twoHanded,
          oneHanded: !twoHanded,
          monk: properties.includes('monk'),
        },
        itemId: ref.itemId,
        source: template.source,
        self: { equipped: Boolean(item?.equipped), attuned: Boolean(item?.attuned) },
        flags: flags(Boolean(template.magical), properties),
      }
    }
    case 'unarmed': {
      const template = sheet.actionTemplates.find((t) => t.kind === 'unarmed')!
      const line = template.damage[0]!
      return {
        name: template.name,
        actionType: 'action',
        attackType: 'melee',
        attack: template.attack ? { ...template.attack } : undefined,
        packets: [
          {
            id: 'unarmed',
            label: 'Unarmed Strike',
            formula: damageFormula(line.dice, line.bonus),
            damageType: line.damageType,
            source: engine,
            weapon: true,
          },
        ],
        costs: [],
        weapon: {
          properties: [],
          category: 'simple',
          twoHanded: false,
          oneHanded: true,
          monk: true,
        },
        source: engine,
        flags: {
          magical: false,
          silvered: false,
          adamantine: false,
          fromSpell: false,
          weapon: true,
        },
      }
    }
    case 'action': {
      const template = sheet.actionTemplates.find((t) => t.id === ref.templateId)
      if (!template)
        return { blocked: 'unknown action', name: ref.templateId, actionType: 'action' }
      const costs: CostSpec[] = template.cost
        ? [
            costSpec(
              template.cost as Parameters<typeof costSpec>[0],
              sheet,
              aggregate,
              template.itemId,
            ),
          ]
        : []
      const base: Base & { check?: undefined } = {
        name: template.name,
        actionType: template.actionType,
        packets: template.damage.map((line, i) => ({
          id: `damage-${i}`,
          label: template.name,
          formula: damageFormula(line.dice, line.bonus),
          damageType: line.damageType,
          source: template.source,
          weapon: false,
        })),
        costs,
        source: template.source,
        flags: {
          magical: true,
          silvered: false,
          adamantine: false,
          fromSpell: false,
          weapon: false,
        },
      }
      if (template.attackType) base.attackType = template.attackType
      if (template.attack) base.attack = { ...template.attack }
      if (template.save)
        base.save = {
          ability: template.save.ability,
          dc: template.save.dc === 'spell' ? numberStat(sheet, 'spell.saveDC') : template.save.dc,
          onSuccess: template.save.onSuccess as 'half' | 'none' | 'special',
        }
      if (template.healing !== undefined) base.healing = template.healing
      if (template.itemId) base.itemId = template.itemId
      return base
    }
    case 'spell': {
      if (!snapshot)
        return {
          blocked: 'casting a spell needs the content snapshot',
          name: ref.spellUid,
          actionType: 'action',
        }
      const entry = entryOfKind(snapshot, ref.spellUid, 'spell')
      if (!entry)
        return {
          blocked: `unknown spell ${ref.spellUid}`,
          name: ref.spellUid,
          actionType: 'action',
        }
      const casting = sheet.spellcasting
      if (!casting)
        return {
          blocked: 'the character cannot cast spells',
          name: entry.name,
          actionType: 'action',
        }
      if (casting.blocked)
        return { blocked: casting.blocked, name: entry.name, actionType: 'action' }
      const source =
        (ref.sourceId ? casting.sources.find((s) => s.id === ref.sourceId) : undefined) ??
        casting.sources.find((s) => s.classUid && entry.data.classes.includes(s.classUid)) ??
        casting.sources.find((s) => s.id === casting.primary)!
      const level = entry.data.level
      const costs: CostSpec[] = []
      let slotLevel = level
      if (level > 0) {
        const usePact =
          ref.usePact ??
          (source.progression === 'pact' &&
            !casting.slots.some((s) => s.level >= level && s.max - s.used > 0))
        if (usePact || source.progression === 'pact') {
          const pact = casting.pact
          const available = pact ? pact.slots - pact.used : 0
          slotLevel = pact?.level ?? level
          costs.push({
            kind: 'pact',
            amount: 1,
            available,
            sufficient: available > 0 && slotLevel >= level,
          })
        } else {
          const wanted =
            ref.slotLevel ??
            casting.slots.find((s) => s.level >= level && s.max - s.used > 0)?.level ??
            level
          const slot = casting.slots.find((s) => s.level === wanted)
          const available = slot ? slot.max - slot.used : 0
          slotLevel = wanted
          costs.push({
            kind: 'slot',
            level: wanted,
            amount: 1,
            available,
            sufficient: available > 0 && wanted >= level,
          })
        }
      }
      const actionType: ActionType =
        entry.data.castingTimeType === 'bonus'
          ? 'bonus'
          : entry.data.castingTimeType === 'reaction'
            ? 'reaction'
            : entry.data.castingTimeType === 'action'
              ? 'action'
              : 'special'
      const base: Base & { slotLevel: number; castingMod: number } = {
        name: entry.name,
        actionType,
        packets: [],
        costs,
        source: source.source,
        slotLevel,
        castingMod: source.mod,
        flags: {
          magical: true,
          silvered: false,
          adamantine: false,
          fromSpell: true,
          weapon: false,
        },
      }
      if (entry.data.attackType) {
        base.attackType = 'spell'
        base.attack = {
          bonus: source.attack + numberStat(sheet, 'attack.spell'),
          breakdown: [
            {
              source: source.source,
              op: 'add',
              value: source.attack,
              label: `Spell attack (${source.name})`,
              applied: true,
            },
            ...(sheet.stats['attack.spell']?.breakdown.filter((l) => l.applied && l.value !== 0) ??
              []),
          ],
          proficient: true,
          ability: source.ability,
        }
      }
      if (entry.data.save)
        base.save = {
          ability: entry.data.save.ability,
          dc: source.saveDC,
          onSuccess: entry.data.save.onSuccess,
        }
      const dice =
        entry.data.damage?.bySlotLevel?.[String(slotLevel)] ??
        highestKey(entry.data.damage?.bySlotLevel, slotLevel) ??
        (level === 0 ? highestKey(entry.data.damage?.byCharacterLevel, sheet.level) : undefined)
      if (dice && entry.data.damage?.damageType) {
        base.packets.push({
          id: 'spell',
          label: entry.name,
          formula: dice,
          damageType: entry.data.damage.damageType,
          source: source.source,
          weapon: false,
        })
      }
      const healing =
        entry.data.healing?.[String(slotLevel)] ?? highestKey(entry.data.healing, slotLevel)
      if (healing) base.healing = healing.replace(/\bMOD\b/g, 'castingMod')
      if (entry.data.concentration) base.concentration = true
      return base
    }
    case 'check': {
      const skill = ref.skill
      const ability = ref.ability ?? (skill ? ABILITY_OF_SKILL[skill] : undefined)
      if (!ability)
        return { blocked: 'a check needs a skill or an ability', name: 'Check', actionType: 'free' }
      const path = skill ? `skill.${skill}.bonus` : `check.${ability}`
      const stat = sheet.stats[path]
      const bonus = numberStat(sheet, path)
      const label = skill ? `${skill} check` : `${ability.toUpperCase()} check`
      return {
        name: label,
        actionType: 'free',
        packets: [],
        costs: [],
        source: engine,
        flags: {
          magical: false,
          silvered: false,
          adamantine: false,
          fromSpell: false,
          weapon: false,
        },
        check: { label, bonus, breakdown: stat?.breakdown.filter((l) => l.applied) ?? [] },
        ...(diagnostics.length ? {} : {}),
      }
    }
    case 'save': {
      const path = `save.${ref.ability}.bonus`
      const stat = sheet.stats[path]
      return {
        name: `${ref.ability.toUpperCase()} saving throw`,
        actionType: 'free',
        packets: [],
        costs: [],
        source: engine,
        flags: {
          magical: false,
          silvered: false,
          adamantine: false,
          fromSpell: false,
          weapon: false,
        },
        check: {
          label: `${ref.ability.toUpperCase()} saving throw`,
          bonus: numberStat(sheet, path),
          breakdown: stat?.breakdown.filter((l) => l.applied) ?? [],
        },
      }
    }
  }
}

function highestKey(table: Record<string, string> | undefined, atMost: number): string | undefined {
  if (!table) return undefined
  let best: number | undefined
  for (const key of Object.keys(table)) {
    const n = Number(key)
    if (Number.isNaN(n) || n > atMost) continue
    if (best === undefined || n > best) best = n
  }
  return best === undefined ? undefined : table[String(best)]
}

function appliesTo(view: ActionEffectView, ref: ActionRef, base: Base): boolean {
  const scope = (view.effect as { appliesTo?: string }).appliesTo ?? 'all'
  if (view.itemId && scope === 'weapon.self')
    return ref.kind === 'weapon' && ref.itemId === view.itemId
  if (view.itemId && base.itemId !== view.itemId && ref.kind !== 'spell') {
    // Effects on another item (not the one being used) still apply when scoped by attack type.
  }
  switch (scope) {
    case 'all':
      return ref.kind !== 'check' && ref.kind !== 'save'
    case 'weapon.self':
      return false
    case 'unarmed':
      return ref.kind === 'unarmed'
    case 'spell':
      return ref.kind === 'spell' || base.attackType === 'spell'
    case 'melee':
    case 'ranged':
      return base.attackType === scope
    default:
      return false
  }
}

function packetId(view: ActionEffectView): string {
  const effect = view.effect as ActionEffect & { id?: string; oncePerTurn?: string; label?: string }
  return effect.id ?? effect.oncePerTurn ?? slug(effect.label ?? `${view.source.path}`)
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function numberStat(sheet: ComputedSheet, path: string): number {
  const v = sheet.stats[path]?.value
  return typeof v === 'number' ? v : 0
}

function numeric(
  value: string | number,
  scope: FormulaScope,
  source: SourceRef,
  diagnostics: Diagnostic[],
): number | null {
  try {
    return evaluateNumeric(value, scope)
  } catch (error) {
    if (error instanceof FormulaError) {
      diagnostics.push({
        code: error.code,
        severity: 'error',
        message: `${source.name}: ${error.message}`,
        sources: [source],
      })
      return null
    }
    throw error
  }
}

function substitute(
  formula: string,
  scope: FormulaScope,
  source: SourceRef,
  diagnostics: Diagnostic[],
): string | null {
  try {
    return substituteVariables(formula, scope)
  } catch (error) {
    if (error instanceof FormulaError) {
      diagnostics.push({
        code: error.code,
        severity: 'error',
        message: `${source.name}: ${error.message}`,
        sources: [source],
      })
      return null
    }
    throw error
  }
}

function damageFormula(dice: string | null, bonus: number): string {
  if (dice === null) return String(bonus)
  if (bonus === 0) return dice
  return bonus > 0 ? `${dice} + ${bonus}` : `${dice} - ${Math.abs(bonus)}`
}

function critical(formula: string): string {
  const parsed = parse(formula)
  return parsed.ok ? format(multiplyDice(parsed.ast, 2)) : formula
}

function mapDice(formula: string, fn: (d: DiceNode) => DiceNode): string {
  const parsed = parse(formula)
  if (!parsed.ok) return formula
  const walk = (node: Node): Node => {
    switch (node.type) {
      case 'dice':
        return fn(node)
      case 'binary':
        return { ...node, left: walk(node.left), right: walk(node.right) }
      case 'unary':
        return { ...node, operand: walk(node.operand) }
      case 'call':
        return { ...node, args: node.args.map(walk) }
      default:
        return node
    }
  }
  return format(walk(parsed.ast))
}

function withReroll(formula: string, reroll: { values: number[]; once: boolean }): string {
  return mapDice(formula, (d) => {
    if (d.reroll) return d
    const values = [...new Set(reroll.values.filter((v) => v >= 1 && v <= d.faces))].sort(
      (a, b) => a - b,
    )
    if (values.length === 0 || (!reroll.once && values.length >= d.faces)) return d
    return { ...d, reroll: { values, once: reroll.once } }
  })
}

function withReplacedDie(formula: string, faces: number): string {
  return mapDice(formula, (d) => (d.faces < faces ? { ...d, faces } : d))
}

function costSpec(
  cost: {
    resource?: string
    amount?: number
    slotLevel?: number
    orHigher?: boolean
    charges?: number
  },
  sheet: ComputedSheet,
  aggregate: CharacterAggregate,
  itemId?: string,
): CostSpec {
  if (cost.resource) {
    const resource = sheet.resources.find((r) => r.id === cost.resource)
    const amount = cost.amount ?? 1
    const available = resource?.current ?? 0
    return {
      kind: 'resource',
      id: cost.resource,
      amount,
      available,
      sufficient: available >= amount,
    }
  }
  if (cost.slotLevel) {
    const slot = sheet.spellcasting?.slots.find((s) => s.level === cost.slotLevel)
    const available = slot ? slot.max - slot.used : 0
    return { kind: 'slot', level: cost.slotLevel, amount: 1, available, sufficient: available > 0 }
  }
  const charges = cost.charges ?? 1
  const item = itemId ? aggregate.inventory.find((i) => i.id === itemId) : undefined
  const available = item?.chargesCurrent ?? 0
  return {
    kind: 'charges',
    ...(itemId ? { id: itemId } : {}),
    amount: charges,
    available,
    sufficient: available >= charges,
  }
}

function economyOf(actionType: ActionType, aggregate: CharacterAggregate): ActionPlan['economy'] {
  const combat = aggregate.state.combat
  const turn = combat.turn.turnId
  switch (actionType) {
    case 'action':
      if (!combat.turn.ownTurn)
        return { kind: actionType, available: false, reason: 'not your turn' }
      if (combat.actions.usedOnTurnId === turn && combat.actions.budget <= 1)
        return { kind: actionType, available: false, reason: 'action already used this turn' }
      return { kind: actionType, available: true }
    case 'bonus':
      if (!combat.turn.ownTurn)
        return {
          kind: actionType,
          available: false,
          reason: 'bonus actions are only available on your turn',
        }
      if (combat.bonusAction.usedOnTurnId === turn)
        return { kind: actionType, available: false, reason: 'bonus action already used this turn' }
      return { kind: actionType, available: true }
    case 'reaction':
      if (combat.reaction.usedOnTurnId !== null && combat.reaction.usedOnTurnId === turn)
        return { kind: actionType, available: false, reason: 'reaction already used' }
      if (combat.reaction.usedOnTurnId !== null && !combat.turn.ownTurn)
        return {
          kind: actionType,
          available: false,
          reason: 'reaction already used (regained at the start of your next turn)',
        }
      return { kind: actionType, available: true }
    default:
      return { kind: actionType, available: true }
  }
}

export type { ActionTemplate }
