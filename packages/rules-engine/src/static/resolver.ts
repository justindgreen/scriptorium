import type { Predicate } from '@scriptorium/content-schema'
import type {
  BreakdownLine,
  ContributionOp,
  Diagnostic,
  SourceRef,
  StatScalar,
  StatValue,
  StatValueKind,
} from '../types.js'
import { FormulaError, evaluateNumeric, type FormulaScope } from './formula.js'

/** Thrown through the lookup chain when a stat depends on itself. */
export class CycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`cycle: ${cycle.join(' -> ')}`)
    this.name = 'CycleError'
  }
}

export type Lookup = {
  number(path: string): number
  boolean(path: string): boolean
  value(path: string): StatScalar
}

/** Engine-internal computed value with access to other stats. */
export type Compute = { compute: (lookup: Lookup) => StatScalar; label?: string }

export type ContributionValue = StatScalar | { formula: string } | Compute

export type Contribution = {
  target: string
  op: ContributionOp
  value: ContributionValue
  priority?: number
  stackKey?: string
  label?: string
  note?: string
  /** Static-scope predicate; evaluated through the resolver so it may depend on other stats. */
  condition?: Predicate
  source: SourceRef
  index: number
}

export type Phase = 'BASE' | 'REPLACE' | 'ADD' | 'MULTIPLY' | 'CLAMP' | 'FINAL' | 'OVERRIDE'

const PHASE_OF: Record<ContributionOp, Phase> = {
  base: 'BASE',
  formula: 'BASE',
  replace: 'REPLACE',
  union: 'ADD',
  remove: 'ADD',
  add: 'ADD',
  multiply: 'MULTIPLY',
  atLeast: 'CLAMP',
  atMost: 'CLAMP',
  replaceFinal: 'FINAL',
  override: 'OVERRIDE',
}

const PHASE_ORDER: Record<Phase, number> = {
  BASE: 0,
  REPLACE: 1,
  ADD: 2,
  MULTIPLY: 3,
  CLAMP: 4,
  FINAL: 5,
  OVERRIDE: 6,
}

export type ResolverEnv = {
  scope: FormulaScope
  evaluatePredicate(predicate: Predicate, source: SourceRef, lookup: Lookup): boolean
  diagnostic(diagnostic: Diagnostic): void
  /** The label chosen by the user for a formula group with `selection: userChoice`. */
  groupChoice(path: string): string | undefined
}

type Evaluated = {
  contribution: Contribution
  value: StatScalar | null
  applied: boolean
  reason?: BreakdownLine['reason']
}

function defaultFor(kind: StatValueKind): StatScalar {
  switch (kind) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'string':
      return ''
    case 'set':
      return []
  }
}

/**
 * Demand-driven stat resolver (docs/RULES_ENGINE.md §3). Contributions are registered up front,
 * then any stat may be resolved; dependencies are resolved recursively with memoisation and a
 * visiting stack for cycle detection. Results are independent of registration order.
 */
export class StatResolver {
  private readonly contributions = new Map<string, Contribution[]>()
  private readonly kinds = new Map<string, StatValueKind>()
  private readonly groupSelection = new Map<string, 'max' | 'userChoice'>()
  private readonly memo = new Map<string, StatValue>()
  private readonly visiting: string[] = []
  private readonly reportedCycles = new Set<string>()
  readonly lookup: Lookup

  constructor(private readonly env: ResolverEnv) {
    this.lookup = {
      number: (path) => {
        const value = this.resolve(path).value
        return typeof value === 'number' ? value : Number(value) || 0
      },
      boolean: (path) => Boolean(this.resolve(path).value),
      value: (path) => this.resolve(path).value,
    }
  }

  /** Declares a stat and its value kind. Undeclared targets default to `number`. */
  declare(path: string, kind: StatValueKind, selection?: 'max' | 'userChoice'): void {
    if (!this.kinds.has(path)) this.kinds.set(path, kind)
    if (selection) this.groupSelection.set(path, selection)
    if (!this.contributions.has(path)) this.contributions.set(path, [])
  }

  add(contribution: Contribution): void {
    this.declare(contribution.target, this.kinds.get(contribution.target) ?? 'number')
    this.contributions.get(contribution.target)!.push(contribution)
  }

  kindOf(path: string): StatValueKind {
    return this.kinds.get(path) ?? 'number'
  }

  /** Every declared stat path in canonical (sorted) order. */
  paths(): string[] {
    return [...this.contributions.keys()].sort()
  }

  resolve(path: string): StatValue {
    const memoised = this.memo.get(path)
    if (memoised) return memoised
    const at = this.visiting.indexOf(path)
    if (at >= 0) throw new CycleError([...this.visiting.slice(at), path])
    this.visiting.push(path)
    try {
      const value = this.compute(path)
      this.memo.set(path, value)
      return value
    } finally {
      this.visiting.pop()
    }
  }

  /** Resolves every declared stat in canonical order. */
  resolveAll(): Record<string, StatValue> {
    const out: Record<string, StatValue> = {}
    for (const path of this.paths()) out[path] = this.resolve(path)
    return out
  }

  private compute(path: string): StatValue {
    const kind = this.kindOf(path)
    const sorted = [...(this.contributions.get(path) ?? [])].sort(compareContributions)
    const evaluated = sorted.map((contribution) => this.evaluate(contribution, path))
    let error: true | undefined
    for (const e of evaluated) if (e.reason === 'cycle') error = true

    const byPhase = (phase: Phase) =>
      evaluated.filter(
        (e) => e.value !== null && e.applied && PHASE_OF[e.contribution.op] === phase,
      )

    let value: StatScalar = defaultFor(kind)

    // BASE: a single base or a formula group.
    const bases = byPhase('BASE')
    const members = bases.filter((e) => e.contribution.op === 'formula')
    const plainBases = bases.filter((e) => e.contribution.op === 'base')
    if (plainBases.length > 0) {
      const winner = plainBases[plainBases.length - 1]!
      value = winner.value!
      for (const other of plainBases) if (other !== winner) markLost(other, 'lost-priority')
    }
    if (members.length > 0) {
      const chosen = this.pickGroupMember(path, members)
      if (chosen) {
        value = chosen.value!
        for (const other of members) if (other !== chosen) markLost(other, 'lost-group')
        for (const base of plainBases) markLost(base, 'lost-group')
      }
    }

    // REPLACE: highest priority, then highest value, then source order.
    const replaces = byPhase('REPLACE')
    if (replaces.length > 0) {
      const winner = pickReplace(replaces)
      for (const other of replaces) if (other !== winner) markLost(other, 'lost-priority')
      value = winner.value!
      const rivals = replaces.filter(
        (e) =>
          e !== winner &&
          (e.contribution.priority ?? 0) === (winner.contribution.priority ?? 0) &&
          !sameScalar(e.value!, winner.value!),
      )
      if (rivals.length > 0 && kind !== 'boolean') {
        this.env.diagnostic({
          code: 'CONFLICTING_REPLACE',
          severity: 'warning',
          message: `${path}: ${rivals.length + 1} replacements share priority ${winner.contribution.priority ?? 0} with different values; the highest applies`,
          statPath: path,
          sources: [winner.contribution.source, ...rivals.map((r) => r.contribution.source)],
        })
      }
    }

    // ADD: sum (numbers), union/remove (sets); stack keys collapse to the highest.
    const adds = byPhase('ADD')
    if (kind === 'set') {
      const set = new Set(asSet(value))
      for (const e of adds) {
        if (e.contribution.op === 'remove') for (const v of asSet(e.value!)) set.delete(v)
        else for (const v of asSet(e.value!)) set.add(v)
      }
      value = [...set].sort()
    } else if (kind === 'number') {
      const groups = new Map<string, Evaluated[]>()
      const singles: Evaluated[] = []
      for (const e of adds) {
        const key = e.contribution.stackKey
        if (key) {
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(e)
        } else singles.push(e)
      }
      let sum = asNumber(value)
      for (const e of singles) sum += asNumber(e.value!)
      for (const group of groups.values()) {
        let best = group[0]!
        for (const e of group) if (asNumber(e.value!) > asNumber(best.value!)) best = e
        sum += asNumber(best.value!)
        for (const e of group) if (e !== best) markLost(e, 'stack-key')
      }
      value = sum
    } else if (kind === 'boolean') {
      for (const e of adds) value = Boolean(value) || Boolean(e.value)
    }

    // MULTIPLY
    if (kind === 'number') {
      for (const e of byPhase('MULTIPLY')) value = asNumber(value) * asNumber(e.value!)
    }

    // CLAMP: atLeast then atMost
    if (kind === 'number') {
      const clamps = byPhase('CLAMP')
      const floors = clamps.filter((e) => e.contribution.op === 'atLeast')
      const ceilings = clamps.filter((e) => e.contribution.op === 'atMost')
      if (floors.length > 0) {
        const floor = Math.max(...floors.map((e) => asNumber(e.value!)))
        const before = asNumber(value)
        value = Math.max(before, floor)
        for (const e of floors)
          if (asNumber(e.value!) < floor || before >= floor) markLost(e, 'unused-clamp')
      }
      if (ceilings.length > 0) {
        const ceiling = Math.min(...ceilings.map((e) => asNumber(e.value!)))
        const before = asNumber(value)
        value = Math.min(before, ceiling)
        for (const e of ceilings)
          if (asNumber(e.value!) > ceiling || before <= ceiling) markLost(e, 'unused-clamp')
      }
    }

    // FINAL
    const finals = byPhase('FINAL')
    if (finals.length > 0) {
      const winner = pickReplace(finals)
      for (const other of finals) if (other !== winner) markLost(other, 'lost-priority')
      value = winner.value!
    }

    // OVERRIDE: at most one, the auto value is kept alongside.
    let override: StatValue['override']
    const overrides = byPhase('OVERRIDE')
    if (overrides.length > 0) {
      const manual = overrides[overrides.length - 1]!
      for (const other of overrides) if (other !== manual) markLost(other, 'overridden')
      override = { auto: value, manual: manual.value!, note: manual.contribution.note }
      value = manual.value!
    }

    const breakdown: BreakdownLine[] = evaluated.map((e) => ({
      source: e.contribution.source,
      op: e.contribution.op,
      value: e.value,
      label: e.contribution.label ?? labelOf(e.contribution.value),
      note: e.contribution.note,
      applied: e.applied,
      reason: e.reason,
    }))
    const result: StatValue = { path, kind, value, breakdown }
    if (override) result.override = override
    if (error) result.error = true
    return result
  }

  private pickGroupMember(path: string, members: Evaluated[]): Evaluated | undefined {
    if (this.groupSelection.get(path) === 'userChoice') {
      const label = this.env.groupChoice(path)
      const chosen = label ? members.find((m) => m.contribution.label === label) : undefined
      if (chosen) return chosen
    }
    let best: Evaluated | undefined
    for (const m of members) {
      if (!best || asNumber(m.value!) > asNumber(best.value!)) best = m
    }
    return best
  }

  private evaluate(contribution: Contribution, path: string): Evaluated {
    try {
      if (contribution.condition) {
        const ok = this.env.evaluatePredicate(
          contribution.condition,
          contribution.source,
          this.lookup,
        )
        if (!ok) return { contribution, value: null, applied: false, reason: 'condition-false' }
      }
      const value = this.evaluateValue(contribution.value)
      return { contribution, value, applied: true }
    } catch (error) {
      if (error instanceof CycleError) {
        const key = [...error.cycle].sort().join('|')
        if (!this.reportedCycles.has(key)) {
          this.reportedCycles.add(key)
          this.env.diagnostic({
            code: 'CYCLE_DETECTED',
            severity: 'error',
            message: `${path}: "${contribution.source.name}" depends on itself (${error.cycle.join(' -> ')}); it was ignored`,
            statPath: path,
            sources: [contribution.source],
          })
        }
        return { contribution, value: null, applied: false, reason: 'cycle' }
      }
      if (error instanceof FormulaError) {
        this.env.diagnostic({
          code: error.code,
          severity: 'error',
          message: `${path}: ${error.message} (from "${contribution.source.name}")`,
          statPath: path,
          sources: [contribution.source],
        })
        return { contribution, value: null, applied: false, reason: 'formula-error' }
      }
      throw error
    }
  }

  private evaluateValue(value: ContributionValue): StatScalar {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if ('formula' in value) return evaluateNumeric(value.formula, this.env.scope)
      return value.compute(this.lookup)
    }
    return value
  }
}

function compareContributions(a: Contribution, b: Contribution): number {
  return (
    PHASE_ORDER[PHASE_OF[a.op]] - PHASE_ORDER[PHASE_OF[b.op]] ||
    (b.priority ?? 0) - (a.priority ?? 0) ||
    a.source.order - b.source.order ||
    a.index - b.index
  )
}

function pickReplace(candidates: Evaluated[]): Evaluated {
  let winner = candidates[0]!
  for (const c of candidates) {
    const pc = c.contribution.priority ?? 0
    const pw = winner.contribution.priority ?? 0
    if (pc > pw) winner = c
    else if (
      pc === pw &&
      typeof c.value === 'number' &&
      typeof winner.value === 'number' &&
      c.value > winner.value
    ) {
      winner = c
    }
  }
  return winner
}

function markLost(e: Evaluated, reason: BreakdownLine['reason']) {
  e.applied = false
  e.reason = reason
}

function asNumber(v: StatScalar): number {
  return typeof v === 'number' ? v : Number(v) || 0
}

function asSet(v: StatScalar): string[] {
  return Array.isArray(v) ? v : typeof v === 'string' && v !== '' ? [v] : []
}

function sameScalar(a: StatScalar, b: StatScalar): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function labelOf(value: ContributionValue): string | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if ('formula' in value) return value.formula
    return value.label
  }
  return undefined
}
