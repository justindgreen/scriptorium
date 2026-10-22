import type { Ability, ContentEntryOf, StaticEffect } from '@scriptorium/content-schema'
import { entryOfKind } from '../snapshot.js'
import type {
  CharacterAggregate,
  ContentSnapshot,
  Diagnostic,
  RulesetProfile,
  SourceRef,
  SpellcastingSource,
  SpellcastingView,
  StatValue,
} from '../types.js'
import type { EffectOutputs } from './effects.js'
import { FormulaError, evaluateNumeric, type FormulaScope } from './formula.js'
import type { Grants } from './grants.js'
import type { StatResolver } from './resolver.js'

type Progression = 'full' | 'half' | 'third' | 'pact' | 'none'
type Preparation = 'known' | 'prepared' | 'spellbook'

type Draft = {
  id: string
  name: string
  ability: Ability
  progression: Progression
  preparation: Preparation
  list?: string
  classUid?: string
  subclassUid?: string
  classLevel: number
  source: SourceRef
  /** Per-class-level slot rows from the class data, when present. */
  slotRows?: Array<number[] | undefined>
  cantripsByLevel?: number[]
  knownByLevel?: number[]
  preparedFormula?: string
  alwaysPrepared: string[]
}

export type SpellcastingContext = {
  aggregate: CharacterAggregate
  grants: Grants
  outputs: EffectOutputs
  ruleset: RulesetProfile
  resolver: StatResolver
  snapshot: ContentSnapshot
  scope: FormulaScope
  diagnostic: (d: Diagnostic) => void
}

/**
 * Spell slots, DC, attack, preparation and known limits (docs/RULES_ENGINE.md §6, 2014 rules).
 * Registers the `spell.*` stats and returns a finaliser that builds the sheet view once every
 * stat is resolved. Returns null from the finaliser when the character has no spellcasting.
 */
export function registerSpellcasting(
  ctx: SpellcastingContext,
): (stats: Record<string, StatValue>, blocked?: string) => SpellcastingView | null {
  const { grants, outputs, ruleset, resolver } = ctx
  const drafts = collectDrafts(ctx)
  const engine = grants.engineSource
  let index = 0
  const add = (
    target: string,
    op: 'base' | 'add',
    value: number | { compute: (l: { number(path: string): number }) => number },
    source: SourceRef = engine,
    label?: string,
  ) => {
    resolver.add({ target, op, value, source, index: index++, ...(label ? { label } : {}) })
  }

  const hasExtras =
    grants.chosenSpells.length > 0 || outputs.deferred.some((i) => i.effect.type === 'spell.grant')
  if (drafts.length === 0) {
    if (!hasExtras) return () => null
    // Innate or chosen spells without a spellcasting class: list them, no slots or DC.
    return () => {
      const view: SpellcastingView = {
        sources: [],
        primary: '',
        casterLevel: 0,
        slots: [],
        pact: null,
        known: knownSpells(ctx, []),
        granted: grantedSpells(ctx),
        preparedCount: 0,
      }
      return view
    }
  }

  const casters = drafts.filter(
    (d) => d.progression === 'full' || d.progression === 'half' || d.progression === 'third',
  )
  const pact = drafts.find((d) => d.progression === 'pact')
  const primary = drafts[0]!

  // Slots (2014): one spellcasting class uses its own table; several combine into a caster level.
  const casterLevel = casters.reduce((sum, d) => sum + casterLevelsOf(d), 0)
  const slotTable: number[] = new Array<number>(9).fill(0)
  if (casters.length === 1) {
    const only = casters[0]!
    const row =
      only.slotRows?.[only.classLevel - 1] ??
      ruleset.config.spellSlots[only.progression as 'full' | 'half' | 'third'][only.classLevel - 1]
    for (let i = 0; i < 9; i += 1) slotTable[i] = row?.[i] ?? 0
  } else if (casters.length > 1 && casterLevel > 0) {
    const row =
      ruleset.config.spellSlots.multiclass[
        Math.min(casterLevel, ruleset.config.spellSlots.multiclass.length) - 1
      ]
    for (let i = 0; i < 9; i += 1) slotTable[i] = row?.[i] ?? 0
  }
  const slotLabel =
    casters.length > 1
      ? `Multiclass caster level ${casterLevel}`
      : casters[0]
        ? `${casters[0].name} ${casters[0].classLevel}`
        : 'No spell slots'
  for (let level = 1; level <= 9; level += 1)
    add(`spell.slots.${level}`, 'base', slotTable[level - 1] ?? 0, grants.rulesetSource, slotLabel)
  const pactRow = pact
    ? ruleset.config.spellSlots.pact[
        Math.min(pact.classLevel, ruleset.config.spellSlots.pact.length) - 1
      ]
    : undefined
  add(
    'spell.pact.slots',
    'base',
    pactRow?.slots ?? 0,
    grants.rulesetSource,
    pact ? `${pact.name} ${pact.classLevel}` : undefined,
  )
  add(
    'spell.pact.level',
    'base',
    pactRow?.level ?? 0,
    grants.rulesetSource,
    pact ? `${pact.name} ${pact.classLevel}` : undefined,
  )

  for (const instance of outputs.deferred) {
    if (instance.effect.type === 'spellSlots.bonus') {
      resolver.add({
        target: `spell.slots.${instance.effect.level}`,
        op: 'add',
        value: instance.effect.count,
        source: instance.source,
        index: index++,
      })
    }
  }

  add(
    'spell.saveDC',
    'base',
    {
      compute: (l) => 8 + l.number('proficiencyBonus') + l.number(`ability.${primary.ability}.mod`),
    },
    engine,
    `8 + PB + ${primary.ability.toUpperCase()} (${primary.name})`,
  )
  add(
    'spell.attack',
    'base',
    { compute: (l) => l.number('proficiencyBonus') + l.number(`ability.${primary.ability}.mod`) },
    engine,
    `PB + ${primary.ability.toUpperCase()} (${primary.name})`,
  )
  add(
    'spell.prepared.max',
    'base',
    { compute: (l) => preparedMaxOf(primary, l.number(`ability.${primary.ability}.mod`), ctx) },
    engine,
    `${primary.name}`,
  )
  add(
    'spell.known.max',
    'base',
    primary.knownByLevel?.[primary.classLevel - 1] ?? 0,
    engine,
    `${primary.name}`,
  )

  return (stats, blocked) => {
    const number = (path: string) => {
      const v = stats[path]?.value
      return typeof v === 'number' ? v : 0
    }
    const sources: SpellcastingSource[] = drafts.map((d) => {
      const mod = number(`ability.${d.ability}.mod`)
      const pb = number('proficiencyBonus')
      const source: SpellcastingSource = {
        id: d.id,
        name: d.name,
        ability: d.ability,
        mod,
        saveDC: 8 + pb + mod,
        attack: pb + mod,
        progression: d.progression,
        preparation: d.preparation,
        casterLevels: casterLevelsOf(d),
        alwaysPrepared: d.alwaysPrepared,
        source: d.source,
      }
      if (d.list) source.list = d.list
      if (d.classUid) source.classUid = d.classUid
      if (d.classUid) source.classLevel = d.classLevel
      const cantrips = d.cantripsByLevel?.[d.classLevel - 1]
      if (cantrips !== undefined) source.cantripsKnown = cantrips
      const known = d.knownByLevel?.[d.classLevel - 1]
      if (known !== undefined && d.preparation === 'known') source.spellsKnown = known
      if (d.preparation !== 'known') source.preparedMax = preparedMaxOf(d, mod, ctx)
      return source
    })

    const slots = []
    for (let level = 1; level <= 9; level += 1) {
      const max = number(`spell.slots.${level}`)
      if (max > 0)
        slots.push({
          level,
          max,
          used: Math.min(ctx.aggregate.state.spellSlotsUsed[String(level)] ?? 0, max),
        })
    }
    const pactSlots = number('spell.pact.slots')
    const view: SpellcastingView = {
      sources,
      primary: primary.id,
      casterLevel,
      slots,
      pact: pact
        ? {
            slots: pactSlots,
            level: number('spell.pact.level'),
            used: Math.min(ctx.aggregate.state.pactSlotsUsed, pactSlots),
          }
        : null,
      known: knownSpells(ctx, sources),
      granted: grantedSpells(ctx),
      preparedCount: 0,
    }
    view.preparedCount = view.known.filter(
      (k) => k.prepared && !k.alwaysPrepared && !k.cantrip,
    ).length
    if (blocked) view.blocked = blocked
    checkLimits(ctx, view)
    return view
  }
}

function casterLevelsOf(d: Draft): number {
  switch (d.progression) {
    case 'full':
      return d.classLevel
    case 'half':
      return Math.floor(d.classLevel / 2)
    case 'third':
      return Math.floor(d.classLevel / 3)
    default:
      return 0
  }
}

function preparedMaxOf(d: Draft, mod: number, ctx: SpellcastingContext): number {
  if (d.preparedFormula) {
    try {
      return Math.max(
        1,
        Math.floor(evaluateNumeric(d.preparedFormula, { ...ctx.scope, castingMod: () => mod })),
      )
    } catch (error) {
      if (error instanceof FormulaError) {
        ctx.diagnostic({
          code: error.code,
          severity: 'error',
          message: `${d.name}: prepared spells formula: ${error.message}`,
          statPath: 'spell.prepared.max',
          sources: [d.source],
        })
        return 1
      }
      throw error
    }
  }
  if (d.preparation === 'known') return 0
  const levels =
    d.progression === 'half'
      ? Math.floor(d.classLevel / 2)
      : d.progression === 'third'
        ? Math.floor(d.classLevel / 3)
        : d.classLevel
  return Math.max(1, mod + levels)
}

function collectDrafts(ctx: SpellcastingContext): Draft[] {
  const { grants, outputs } = ctx
  const drafts: Draft[] = []
  const byClass = new Map<string, Draft>()

  for (const cls of grants.classes) {
    const data = cls.entry.data
    if (data.spellcasting && cls.level >= data.spellcasting.startsAtLevel) {
      const draft: Draft = {
        id: cls.entry.uid,
        name: cls.entry.name,
        ability: data.spellcasting.ability,
        progression: data.spellcasting.progression,
        preparation: data.spellcasting.preparation,
        list: data.spellcasting.list,
        classUid: cls.entry.uid,
        classLevel: cls.level,
        source: cls.source,
        slotRows: data.levels.map((row) => row.spellSlots),
        cantripsByLevel: data.levels.map((row) => row.cantripsKnown ?? 0),
        knownByLevel: data.levels.map((row) => row.spellsKnown ?? 0),
        alwaysPrepared: [],
      }
      drafts.push(draft)
      byClass.set(cls.entry.uid, draft)
    }
    const sub = cls.subclass
    if (sub) {
      const classDraft = byClass.get(cls.entry.uid)
      if (classDraft) {
        for (const row of sub.data.spells)
          if (row.level <= cls.level) classDraft.alwaysPrepared.push(...row.spells)
        if (sub.uid) classDraft.subclassUid = sub.uid
      }
      if (sub.data.spellcasting && cls.level >= (data.subclassLevel ?? 1)) {
        const draft: Draft = {
          id: sub.uid,
          name: sub.name,
          ability: sub.data.spellcasting.ability,
          progression: sub.data.spellcasting.progression,
          preparation: sub.data.spellcasting.preparation,
          list: sub.data.spellcasting.list,
          classUid: cls.entry.uid,
          subclassUid: sub.uid,
          classLevel: cls.level,
          source: cls.subclassSource ?? cls.source,
          cantripsByLevel: [],
          knownByLevel: [],
          alwaysPrepared: [],
        }
        drafts.push(draft)
        byClass.set(cls.entry.uid, draft)
      }
    }
  }

  for (const instance of outputs.deferred) {
    const effect = instance.effect
    if (effect.type !== 'spellcasting.grant') continue
    const owner = classOf(instance.source, grants)
    const existing = owner ? byClass.get(owner.uid) : undefined
    if (existing) {
      existing.ability = effect.ability
      existing.progression = effect.progression
      existing.preparation = effect.preparation
      existing.list = effect.list
      existing.source = instance.source
      if (effect.cantripsKnownByLevel) existing.cantripsByLevel = effect.cantripsKnownByLevel
      if (effect.spellsKnownByLevel) existing.knownByLevel = effect.spellsKnownByLevel
      if (effect.preparedFormula) existing.preparedFormula = effect.preparedFormula
      continue
    }
    const draft: Draft = {
      id: instance.source.path,
      name: instance.source.name,
      ability: effect.ability,
      progression: effect.progression,
      preparation: effect.preparation,
      list: effect.list,
      classLevel: owner ? (grants.facts.classLevels.get(owner.uid) ?? 0) : grants.facts.level,
      source: instance.source,
      alwaysPrepared: [],
    }
    if (owner) draft.classUid = owner.uid
    if (effect.cantripsKnownByLevel) draft.cantripsByLevel = effect.cantripsKnownByLevel
    if (effect.spellsKnownByLevel) draft.knownByLevel = effect.spellsKnownByLevel
    if (effect.preparedFormula) draft.preparedFormula = effect.preparedFormula
    drafts.push(draft)
    if (owner) byClass.set(owner.uid, draft)
  }
  return drafts
}

function classOf(source: SourceRef, grants: Grants): ContentEntryOf<'class'> | undefined {
  for (const cls of grants.classes) {
    if (
      source.path === `class:${cls.entry.uid}` ||
      source.path.startsWith(`class:${cls.entry.uid}@`) ||
      source.path.startsWith(`class:${cls.entry.uid}/`)
    )
      return cls.entry
    if (
      cls.subclass &&
      (source.path === `subclass:${cls.subclass.uid}` ||
        source.path.startsWith(`subclass:${cls.subclass.uid}@`) ||
        source.path.startsWith(`subclass:${cls.subclass.uid}/`))
    )
      return cls.entry
  }
  return undefined
}

function knownSpells(
  ctx: SpellcastingContext,
  sources: SpellcastingSource[],
): SpellcastingView['known'] {
  const out: SpellcastingView['known'] = []
  const seen = new Set<string>()
  for (const spell of ctx.aggregate.definition.spells) {
    const entry = entryOfKind(ctx.snapshot, spell.spellUid, 'spell')
    const level = entry?.data.level
    const row: SpellcastingView['known'][number] = {
      spellUid: spell.spellUid,
      origin: spell.origin,
      prepared: spell.prepared || spell.alwaysPrepared,
      alwaysPrepared: spell.alwaysPrepared,
      cantrip: level === 0,
      ...(level !== undefined ? { level } : {}),
    }
    const classUid = spell.origin.startsWith('class:')
      ? spell.origin.slice('class:'.length)
      : undefined
    const source = classUid ? sources.find((s) => s.classUid === classUid) : undefined
    if (classUid && !source) {
      ctx.diagnostic({
        code: 'INVALID_SELECTION',
        severity: 'warning',
        message: `${spell.spellUid} is attributed to ${classUid}, which has no spellcasting`,
        sources: [ctx.grants.engineSource],
      })
    } else if (source && entry) {
      const onList =
        entry.data.classes.includes(source.classUid!) ||
        source.alwaysPrepared.includes(spell.spellUid) ||
        Boolean(source.list && listIncludes(ctx.snapshot, source.list, spell.spellUid))
      if (!onList) {
        ctx.diagnostic({
          code: 'INVALID_SELECTION',
          severity: 'warning',
          message: `${entry.name} is not on the ${source.name} spell list`,
          sources: [source.source],
        })
      }
      if (source.alwaysPrepared.includes(spell.spellUid)) row.alwaysPrepared = true
      if (row.alwaysPrepared) row.prepared = true
    }
    if (!entry) {
      ctx.diagnostic({
        code: 'MISSING_CONTENT',
        severity: 'error',
        message: `spell "${spell.spellUid}" is not in the content snapshot`,
        sources: [ctx.grants.engineSource],
      })
    }
    out.push(row)
    seen.add(`${spell.origin}|${spell.spellUid}`)
  }
  for (const chosen of ctx.grants.chosenSpells) {
    const list = chosen.filter.list
      ? entryOfKind(ctx.snapshot, chosen.filter.list, 'spell_list')
      : undefined
    for (const uid of chosen.uids) {
      const entry = entryOfKind(ctx.snapshot, uid, 'spell')
      if (!entry) {
        ctx.diagnostic({
          code: 'MISSING_CONTENT',
          severity: 'error',
          message: `chosen spell "${uid}" is not in the content snapshot`,
          sources: [chosen.source],
        })
        continue
      }
      const level = entry.data.level
      const problems: string[] = []
      if (chosen.filter.level !== undefined && level !== chosen.filter.level)
        problems.push(`level ${chosen.filter.level} required`)
      if (chosen.filter.maxLevel !== undefined && level > chosen.filter.maxLevel)
        problems.push(`level ${chosen.filter.maxLevel} or lower required`)
      if (chosen.filter.school && entry.data.school !== chosen.filter.school)
        problems.push(`${chosen.filter.school} school required`)
      if (chosen.filter.list) {
        const onList = list ? list.data.spells.includes(uid) : false
        const viaClass = list?.data.class ? entry.data.classes.includes(list.data.class) : false
        if (!onList && !viaClass)
          problems.push(`not on the ${list?.name ?? chosen.filter.list} list`)
      }
      if (problems.length > 0) {
        ctx.diagnostic({
          code: 'INVALID_SELECTION',
          severity: 'warning',
          message: `${entry.name}: ${problems.join('; ')}`,
          sources: [chosen.source],
        })
      }
      const origin = `choice:${chosen.key}`
      if (seen.has(`${origin}|${uid}`)) continue
      seen.add(`${origin}|${uid}`)
      out.push({
        spellUid: uid,
        origin,
        prepared: true,
        alwaysPrepared: true,
        cantrip: level === 0,
        level,
      })
    }
  }
  for (const source of sources) {
    for (const uid of source.alwaysPrepared) {
      const origin = `class:${source.classUid}`
      if (seen.has(`${origin}|${uid}`)) continue
      const entry = entryOfKind(ctx.snapshot, uid, 'spell')
      out.push({
        spellUid: uid,
        origin,
        prepared: true,
        alwaysPrepared: true,
        cantrip: false,
        ...(entry ? { level: entry.data.level } : {}),
      })
    }
  }
  return out
}

function listIncludes(snapshot: ContentSnapshot, listUid: string, spellUid: string): boolean {
  const list = entryOfKind(snapshot, listUid, 'spell_list')
  return Boolean(list?.data.spells.includes(spellUid))
}

function grantedSpells(ctx: SpellcastingContext): SpellcastingView['granted'] {
  const out: SpellcastingView['granted'] = []
  for (const instance of ctx.outputs.deferred) {
    const effect = instance.effect as StaticEffect
    if (effect.type !== 'spell.grant') continue
    const row: SpellcastingView['granted'][number] = {
      spellUid: effect.spell,
      source: instance.source,
      atWill: effect.atWill,
    }
    if (effect.uses) {
      let max = 0
      try {
        max = Math.floor(evaluateNumeric(effect.uses.max, ctx.scope))
      } catch (error) {
        if (!(error instanceof FormulaError)) throw error
        ctx.diagnostic({
          code: error.code,
          severity: 'error',
          message: `${instance.source.name}: uses formula: ${error.message}`,
          sources: [instance.source],
        })
      }
      row.uses = { max, recharge: effect.uses.recharge }
    }
    if (effect.castAtLevel !== undefined) row.castAtLevel = effect.castAtLevel
    if (effect.chargeCost !== undefined) row.chargeCost = effect.chargeCost
    if (effect.castingAbility) row.castingAbility = effect.castingAbility
    if (!ctx.snapshot.has(effect.spell)) {
      ctx.diagnostic({
        code: 'MISSING_CONTENT',
        severity: 'error',
        message: `granted spell "${effect.spell}" is not in the content snapshot`,
        sources: [instance.source],
      })
    }
    out.push(row)
  }
  return out
}

function checkLimits(ctx: SpellcastingContext, view: SpellcastingView) {
  for (const source of view.sources) {
    if (!source.classUid) continue
    const mine = view.known.filter((k) => k.origin === `class:${source.classUid}`)
    const cantrips = mine.filter((k) => k.cantrip).length
    if (source.cantripsKnown !== undefined && cantrips > source.cantripsKnown) {
      ctx.diagnostic({
        code: 'INVALID_SELECTION',
        severity: 'warning',
        message: `${source.name}: ${cantrips} cantrips known, limit ${source.cantripsKnown}`,
        sources: [source.source],
      })
    }
    if (source.spellsKnown !== undefined) {
      const known = mine.filter((k) => !k.cantrip && !k.alwaysPrepared).length
      if (known > source.spellsKnown) {
        ctx.diagnostic({
          code: 'INVALID_SELECTION',
          severity: 'warning',
          message: `${source.name}: ${known} spells known, limit ${source.spellsKnown}`,
          sources: [source.source],
        })
      }
    }
    if (source.preparedMax !== undefined) {
      const prepared = mine.filter((k) => k.prepared && !k.alwaysPrepared && !k.cantrip).length
      if (prepared > source.preparedMax) {
        ctx.diagnostic({
          code: 'INVALID_SELECTION',
          severity: 'warning',
          message: `${source.name}: ${prepared} spells prepared, limit ${source.preparedMax}`,
          sources: [source.source],
        })
      }
    }
  }
}
