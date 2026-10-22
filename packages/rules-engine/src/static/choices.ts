import {
  ABILITIES,
  SKILLS,
  effectSchema,
  type Ability,
  type Choice,
  type Effect,
  type Skill,
} from '@scriptorium/content-schema'
import type { ChoiceSelection, Diagnostic, PendingChoice, SourceRef } from '../types.js'

export type ChoiceDefinition = {
  /** Stable key the builder stores selections under: `<owner path>/<choice key>`. */
  key: string
  choice: Choice
  source: SourceRef
}

export type SelectionResult = {
  /** Effects granted by the selection, each with the path they should be attributed to. */
  grants: Array<{ effects: Effect[]; path: string; name: string }>
  featureUids: string[]
  featUids: string[]
  contentUids: string[]
  pending?: PendingChoice
  diagnostics: Diagnostic[]
}

const SKILL_NAMES: Record<Skill, string> = {
  acrobatics: 'Acrobatics',
  'animal-handling': 'Animal Handling',
  arcana: 'Arcana',
  athletics: 'Athletics',
  deception: 'Deception',
  history: 'History',
  insight: 'Insight',
  intimidation: 'Intimidation',
  investigation: 'Investigation',
  medicine: 'Medicine',
  nature: 'Nature',
  perception: 'Perception',
  performance: 'Performance',
  persuasion: 'Persuasion',
  religion: 'Religion',
  'sleight-of-hand': 'Sleight of Hand',
  stealth: 'Stealth',
  survival: 'Survival',
}

const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

/**
 * Turns a stored selection into grants, or into a pending choice when it is missing or
 * incomplete (docs/RULES_ENGINE.md §5). Illegal selections are reported and ignored.
 */
export function applySelection(
  definition: ChoiceDefinition,
  selection: ChoiceSelection | undefined,
): SelectionResult {
  const { choice, key, source } = definition
  const result: SelectionResult = {
    grants: [],
    featureUids: [],
    featUids: [],
    contentUids: [],
    diagnostics: [],
  }
  const invalid = (message: string) => {
    result.diagnostics.push({
      code: 'INVALID_SELECTION',
      severity: 'warning',
      message: `${choice.name} (${key}): ${message}`,
      sources: [source],
    })
  }
  const pending = (selected: string[], remaining: number, options?: PendingChoice['options']) => {
    if (remaining > 0) {
      result.pending = {
        key,
        name: choice.name,
        description: choice.description,
        count: choice.count,
        remaining,
        from: { ...choice.from } as PendingChoice['from'],
        options,
        selected,
        source,
      }
    }
  }
  const from = choice.from

  if (selection && selection.kind !== from.kind) {
    invalid(`stored selection is of kind "${selection.kind}" but the choice is "${from.kind}"`)
    selection = undefined
  }

  switch (from.kind) {
    case 'optionSet': {
      const ids = selection?.kind === 'optionSet' ? selection.options : []
      const valid: string[] = []
      for (const id of ids) {
        const option = from.options.find((o) => o.id === id)
        if (!option) {
          invalid(`unknown option "${id}"`)
          continue
        }
        if (valid.includes(id)) continue
        valid.push(id)
        const effects: Effect[] = []
        for (const raw of option.effects) {
          const parsed = effectSchema.safeParse(raw)
          if (parsed.success) effects.push(parsed.data)
          else
            invalid(
              `option "${id}" has an invalid effect: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
            )
        }
        if (effects.length > 0) {
          result.grants.push({ effects, path: `${key}/option:${id}`, name: option.name })
        }
        if (option.feature) result.featureUids.push(option.feature)
      }
      const selected = valid.slice(0, choice.count)
      pending(
        selected,
        choice.count - selected.length,
        from.options.map((o) => ({ id: o.id, name: o.name })),
      )
      break
    }
    case 'skill': {
      const allowed = from.from ?? [...SKILLS]
      const picked = selection?.kind === 'skill' ? selection.skills : []
      const valid = picked.filter((s, i) => {
        if (!allowed.includes(s)) {
          invalid(`"${s}" is not among the offered skills`)
          return false
        }
        return picked.indexOf(s) === i
      })
      const selected = valid.slice(0, choice.count)
      if (selected.length > 0) {
        result.grants.push({
          effects: selected.map((skill) => ({
            type: 'proficiency.grant',
            kind: 'skill',
            target: skill,
            level: from.expertise ? 'expertise' : 'proficient',
          })),
          path: key,
          name: choice.name,
        })
      }
      pending(
        selected,
        choice.count - selected.length,
        allowed.map((s) => ({ id: s, name: SKILL_NAMES[s] })),
      )
      break
    }
    case 'expertise': {
      const picked = selection?.kind === 'expertise' ? dedupe(selection.skills) : []
      const selected = picked.slice(0, choice.count)
      if (selected.length > 0) {
        result.grants.push({
          effects: selected.map((skill) => ({
            type: 'proficiency.grant',
            kind: 'skill',
            target: skill,
            level: 'expertise',
          })),
          path: key,
          name: choice.name,
        })
      }
      pending(selected, choice.count - selected.length)
      break
    }
    case 'tool': {
      const picked = selection?.kind === 'tool' ? dedupe(selection.tools) : []
      const valid = picked.filter((t) => {
        if (from.from && !from.from.includes(t)) {
          invalid(`"${t}" is not among the offered tools`)
          return false
        }
        return true
      })
      const selected = valid.slice(0, choice.count)
      if (selected.length > 0) {
        result.grants.push({
          effects: selected.map((tool) => ({
            type: 'proficiency.grant',
            kind: 'tool',
            target: tool,
            level: 'proficient',
          })),
          path: key,
          name: choice.name,
        })
      }
      pending(
        selected,
        choice.count - selected.length,
        from.from?.map((t) => ({ id: t, name: t })),
      )
      break
    }
    case 'language': {
      const picked = selection?.kind === 'language' ? dedupe(selection.languages) : []
      const valid = picked.filter((l) => {
        if (from.from && !from.from.includes(l)) {
          invalid(`"${l}" is not among the offered languages`)
          return false
        }
        return true
      })
      const selected = valid.slice(0, choice.count)
      if (selected.length > 0) {
        result.grants.push({
          effects: selected.map((language) => ({ type: 'language.grant', language })),
          path: key,
          name: choice.name,
        })
      }
      pending(
        selected,
        choice.count - selected.length,
        from.from?.map((l) => ({ id: l, name: l })),
      )
      break
    }
    case 'abilityIncrease': {
      const increases = selection?.kind === 'abilityIncrease' ? selection.increases : {}
      const spent = applyIncreases(increases, from.points, from.maxPerAbility, from.from, invalid)
      if (spent.effects.length > 0)
        result.grants.push({ effects: spent.effects, path: key, name: choice.name })
      pending(
        spent.selected,
        from.points - spent.points,
        (from.from ?? [...ABILITIES]).map((a) => ({ id: a, name: ABILITY_NAMES[a] })),
      )
      break
    }
    case 'feat': {
      const picked = selection?.kind === 'feat' ? dedupe(selection.feats) : []
      const selected = picked.slice(0, choice.count)
      result.featUids.push(...selected)
      pending(selected, choice.count - selected.length)
      break
    }
    case 'content': {
      const picked = selection?.kind === 'content' ? dedupe(selection.entries) : []
      const selected = picked.slice(0, choice.count)
      result.contentUids.push(...selected)
      pending(selected, choice.count - selected.length)
      break
    }
    case 'asiOrFeat': {
      if (!selection || selection.kind !== 'asiOrFeat') {
        pending([], 1, [
          { id: 'asi', name: 'Ability score improvement' },
          { id: 'feat', name: 'Feat' },
        ])
        break
      }
      if (selection.choice === 'feat') {
        if (selection.feat) result.featUids.push(selection.feat)
        pending(selection.feat ? ['feat', selection.feat] : ['feat'], selection.feat ? 0 : 1)
      } else {
        const spent = applyIncreases(selection.increases ?? {}, 2, 2, undefined, invalid)
        if (spent.effects.length > 0)
          result.grants.push({ effects: spent.effects, path: key, name: choice.name })
        pending(['asi', ...spent.selected], 2 - spent.points)
      }
      break
    }
  }
  return result
}

function applyIncreases(
  increases: Partial<Record<Ability, number>>,
  points: number,
  maxPerAbility: number,
  allowed: readonly Ability[] | undefined,
  invalid: (message: string) => void,
): { effects: Effect[]; selected: string[]; points: number } {
  const effects: Effect[] = []
  const selected: string[] = []
  let spent = 0
  for (const ability of ABILITIES) {
    const raw = increases[ability]
    if (!raw) continue
    if (allowed && !allowed.includes(ability)) {
      invalid(`${ABILITY_NAMES[ability]} cannot be increased by this choice`)
      continue
    }
    let amount = Math.max(0, Math.floor(raw))
    if (amount > maxPerAbility) {
      invalid(`${ABILITY_NAMES[ability]} may be increased by at most ${maxPerAbility}`)
      amount = maxPerAbility
    }
    if (spent + amount > points) {
      invalid(`increases exceed the ${points} available points`)
      amount = Math.max(0, points - spent)
    }
    if (amount === 0) continue
    spent += amount
    selected.push(`${ability}+${amount}`)
    effects.push({ type: 'abilityScore.bonus', ability, value: amount })
  }
  return { effects, selected, points: spent }
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)]
}
