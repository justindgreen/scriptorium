import type { Ability } from '@scriptorium/content-schema'
import { ENGINE_VERSION } from '../version.js'
import type {
  CharacterAggregate,
  ComputedSheet,
  ContentSnapshot,
  Diagnostic,
  ProficiencyView,
  ResourceView,
  RulesetProfile,
  SheetFacts,
  SourceRef,
  StatValue,
} from '../types.js'
import { addEngineContributions } from './base.js'
import { applyEffects, createEffectOutputs } from './effects.js'
import { FormulaError, type FormulaScope } from './formula.js'
import { collectGrants, type Grants } from './grants.js'
import { evaluateStaticPredicate, type PredicateEnv } from './predicates.js'
import { CycleError, StatResolver } from './resolver.js'
import { registerSpellcasting } from './spellcasting.js'
import { buildActionTemplates } from './templates.js'

/**
 * Static sheet computation (docs/RULES_ENGINE.md §2): pure, deterministic, never rolls.
 * Same aggregate + snapshot + ruleset always yields the same sheet, byte for byte.
 */
export function computeSheet(
  aggregate: CharacterAggregate,
  snapshot: ContentSnapshot,
  ruleset: RulesetProfile,
): ComputedSheet {
  const diagnostics: Diagnostic[] = []
  const diagnostic = (d: Diagnostic) => diagnostics.push(d)

  // 1. Grants
  const grants = collectGrants(aggregate, snapshot)
  diagnostics.push(...grants.diagnostics)

  // 2. Resolver with its formula scope and predicate environment.
  // The scope and predicate environment read the resolver lazily; it exists before they run.
  const scope = createScope(aggregate, grants, () => resolver)
  const predicateEnv: PredicateEnv = {
    facts: grants.facts,
    get lookup() {
      return resolver.lookup
    },
    diagnostic,
  }
  const groupChoiceKey = (path: string) => `stat:${path}`
  const resolver: StatResolver = new StatResolver({
    scope,
    diagnostic,
    evaluatePredicate: (predicate, source, _lookup) => {
      const self = sourceSelf(grants, source)
      return evaluateStaticPredicate(predicate, predicateEnv, source, self)
    },
    groupChoice: (path) => {
      const selection = aggregate.definition.choices[groupChoiceKey(path)]
      return selection?.kind === 'optionSet' ? selection.options[0] : undefined
    },
  })

  // 3. Contributions: effects, engine bases, manual overrides.
  const outputs = createEffectOutputs()
  applyEffects(grants.effects, resolver, grants.proficiencies, outputs, diagnostic)
  addEngineContributions({ aggregate, grants, ruleset, resolver, diagnostic })
  const finishSpellcasting = registerSpellcasting({
    aggregate,
    grants,
    outputs,
    ruleset,
    resolver,
    snapshot,
    scope,
    diagnostic,
  })
  aggregate.definition.overrides.forEach((override, index) => {
    const source: SourceRef = {
      kind: 'override',
      name: 'Manual override',
      path: `override:${override.statPath}`,
      order: 1_000_000 + index,
    }
    const kind = resolver.kindOf(override.statPath)
    const expected = kind === 'set' ? 'object' : kind
    if (typeof override.value !== expected) {
      diagnostic({
        code: 'INVALID_SELECTION',
        severity: 'warning',
        message: `override for ${override.statPath} has type ${typeof override.value}, expected ${kind}; ignored`,
        statPath: override.statPath,
        sources: [source],
      })
      return
    }
    resolver.add({
      target: override.statPath,
      op: 'override',
      value: override.value,
      source,
      index,
      ...(override.note ? { note: override.note } : {}),
    })
  })

  // 4. Resolve everything in canonical order.
  const stats = resolver.resolveAll()

  // 5. Post-resolution checks: choice prerequisites.
  checkChoicePrerequisites(aggregate, grants, predicateEnv, diagnostic)

  // 6. Views
  for (const feature of grants.features) {
    if (feature.automation === 'manual') {
      diagnostic({
        code: 'MANUAL_FEATURE',
        severity: 'info',
        message: `${feature.name} is tracked manually`,
        sources: [feature.source],
      })
    } else if (feature.automation === 'partial') {
      diagnostic({
        code: 'PARTIAL_AUTOMATION',
        severity: 'info',
        message: `${feature.name} is partly automated; manual: ${(feature.manualParts ?? []).join(', ')}`,
        sources: [feature.source],
      })
    } else if (feature.automation === 'pending') {
      diagnostic({
        code: 'MANUAL_FEATURE',
        severity: 'info',
        message: `${feature.name} has no mechanics authored yet`,
        sources: [feature.source],
      })
    }
  }

  const resources: ResourceView[] = []
  for (const [id, instance] of outputs.resources) {
    const max = stats[`resource.${id}.max`] ?? resolver.resolve(`resource.${id}.max`)
    const maxValue = typeof max.value === 'number' ? max.value : 0
    const stored = aggregate.state.resources[id]
    const view: ResourceView = {
      id,
      name: instance.definition.name,
      max,
      current: stored === undefined ? maxValue : Math.min(stored, maxValue),
      recharge: instance.definition.recharge,
      source: instance.source,
    }
    if (instance.definition.displayDie) view.displayDie = instance.definition.displayDie
    if (typeof instance.definition.rechargeAmount === 'number')
      view.rechargeAmount = instance.definition.rechargeAmount
    resources.push(view)
  }
  resources.sort((a, b) => a.id.localeCompare(b.id))

  const hitDice = (['d4', 'd6', 'd8', 'd10', 'd12'] as const)
    .map((die) => ({
      die,
      max: numberOf(stats[`hitDice.${die}.max`]),
      spent: aggregate.state.hitDiceSpent[die] ?? 0,
    }))
    .filter((h) => h.max > 0)

  const actionTemplates = buildActionTemplates({ grants, outputs, resolver, predicateEnv, scope })

  const armorBlocked = diagnostics.some((d) => d.code === 'PROFICIENCY_VIOLATION')
  const spellcasting = finishSpellcasting(
    stats,
    armorBlocked ? 'cannot cast spells while wearing armor without proficiency' : undefined,
  )
  const hpMax = numberOf(stats['hp.max'])
  return {
    engineVersion: ENGINE_VERSION,
    rulesetId: aggregate.rulesetId,
    characterId: aggregate.id,
    revision: aggregate.revision,
    level: grants.facts.level,
    classes: grants.classes.map((c) => ({
      classUid: c.entry.uid,
      name: c.entry.name,
      ...(c.subclass ? { subclassUid: c.subclass.uid, subclassName: c.subclass.name } : {}),
      level: c.level,
      hitDie: c.entry.data.hitDie,
    })),
    stats,
    proficiencies: {
      armor: toProficiencyViews(grants.proficiencies.armor),
      weapons: toProficiencyViews(grants.proficiencies.weapons),
      tools: toProficiencyViews(grants.proficiencies.tools),
      languages: toProficiencyViews(grants.proficiencies.languages),
    },
    features: grants.features,
    resources,
    defenses: outputs.defenses,
    conditionImmunities: outputs.conditionImmunities,
    toggles: grants.toggles,
    actionTemplates,
    pendingChoices: grants.pendingChoices,
    diagnostics,
    hitDice,
    hp: {
      max: hpMax,
      current: Math.min(aggregate.state.hpCurrent, hpMax),
      temp: aggregate.state.hpTemp,
    },
    spellcasting,
    facts: serializeFacts(grants.facts),
    actionEffects: outputs.actionEffects.map((e) => ({
      effect: e.effect,
      source: e.source,
      ...(e.self ? { itemId: e.self.itemId } : {}),
    })),
  }
}

function serializeFacts(facts: Grants['facts']): SheetFacts {
  return {
    level: facts.level,
    classLevels: Object.fromEntries(facts.classLevels),
    speciesChain: [...facts.speciesChain],
    subclasses: [...facts.subclasses],
    features: [...facts.features],
    conditions: [...facts.conditions],
    activeToggles: [...facts.activeToggles],
    armorCategory: facts.armorCategory,
    shield: facts.shield,
    equippedItems: [...facts.equippedItems],
    attunedItems: [...facts.attunedItems],
  }
}

function numberOf(stat: StatValue | undefined): number {
  return stat && typeof stat.value === 'number' ? stat.value : 0
}

function toProficiencyViews(map: Map<string, SourceRef[]>): ProficiencyView[] {
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, sources]) => ({ id, sources }))
}

/** Static formula variables resolve through the stat resolver (docs/RULES_ENGINE.md §4). */
function createScope(
  aggregate: CharacterAggregate,
  grants: Grants,
  resolver: () => StatResolver,
): FormulaScope {
  const classLevels = grants.facts.classLevels
  const castingAbility = findCastingAbility(grants)
  return {
    abilityMod: (ability) => resolver().lookup.number(`ability.${ability}.mod`),
    abilityScore: (ability) => resolver().lookup.number(`ability.${ability}.score`),
    proficiencyBonus: () => resolver().lookup.number('proficiencyBonus'),
    level: () => grants.facts.level,
    classLevel: (uid) => classLevels.get(uid) ?? 0,
    slotLevel: () => {
      throw new FormulaError('slotLevel is only available when casting a spell', 'UNKNOWN_VARIABLE')
    },
    castingMod: () => {
      if (!castingAbility)
        throw new FormulaError(
          'castingMod is not available: the character has no spellcasting',
          'UNKNOWN_VARIABLE',
        )
      return resolver().lookup.number(`ability.${castingAbility}.mod`)
    },
    table: (name, level) => {
      for (const cls of grants.classes) {
        const rows = cls.entry.data.levels
        if (!rows.some((r) => name in r.columns)) continue
        const clamped = Math.max(1, Math.min(Math.floor(level), rows.length))
        const row = rows.find((r) => r.level === clamped) ?? rows[clamped - 1]
        const raw = row?.columns[name]
        if (raw === undefined) return 0
        const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
        if (Number.isNaN(n))
          throw new FormulaError(
            `table "${name}" at level ${clamped} is not numeric ("${raw}")`,
            'FORMULA_ERROR',
          )
        return n
      }
      throw new FormulaError(`unknown table "${name}" for ${aggregate.name}`, 'FORMULA_ERROR')
    },
  }
}

function findCastingAbility(grants: Grants): Ability | undefined {
  for (const instance of grants.effects) {
    if (instance.active && instance.effect.type === 'spellcasting.grant')
      return instance.effect.ability
  }
  for (const cls of grants.classes) {
    if (cls.entry.data.spellcasting) return cls.entry.data.spellcasting.ability
  }
  return undefined
}

function sourceSelf(grants: Grants, source: SourceRef) {
  if (source.kind !== 'item') return undefined
  const instance = grants.effects.find((e) => e.source === source && e.self)
  return instance?.self
}

function checkChoicePrerequisites(
  aggregate: CharacterAggregate,
  grants: Grants,
  env: PredicateEnv,
  diagnostic: (d: Diagnostic) => void,
) {
  const safeEvaluate = (
    predicate: NonNullable<Grants['choiceDefinitions'][number]['choice']['prerequisite']>,
    source: SourceRef,
  ) => {
    try {
      return evaluateStaticPredicate(predicate, env, source)
    } catch (error) {
      if (error instanceof CycleError || error instanceof FormulaError) return true
      throw error
    }
  }
  for (const definition of grants.choiceDefinitions) {
    const { choice, key, source } = definition
    const selection = aggregate.definition.choices[key]
    if (choice.prerequisite && !safeEvaluate(choice.prerequisite, source)) {
      const index = grants.pendingChoices.findIndex((p) => p.key === key)
      if (index >= 0) grants.pendingChoices.splice(index, 1)
      if (selection) {
        diagnostic({
          code: 'PREREQ_UNMET',
          severity: 'warning',
          message: `${choice.name}: prerequisite not met`,
          sources: [source],
        })
      }
      continue
    }
    if (choice.from.kind !== 'optionSet') continue
    const pending = grants.pendingChoices.find((p) => p.key === key)
    for (const option of choice.from.options) {
      if (!option.prerequisite) continue
      const ok = safeEvaluate(option.prerequisite, source)
      if (ok) continue
      const view = pending?.options?.find((o) => o.id === option.id)
      if (view) view.disabledReason = 'prerequisite not met'
      if (selection?.kind === 'optionSet' && selection.options.includes(option.id)) {
        diagnostic({
          code: 'PREREQ_UNMET',
          severity: 'warning',
          message: `${choice.name}: "${option.name}" requires a prerequisite the character does not meet`,
          sources: [source],
        })
      }
    }
  }
}
