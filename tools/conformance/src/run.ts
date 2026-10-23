/**
 * Conformance runner (docs/TEST_STRATEGY.md §3, §4): declaration checks and behavioural cases
 * for every content entry, executed through the real engine. Pure apart from reading files.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  contentPackageSchema,
  rulesetConfigSchema,
  type BehaviouralCase,
  type ContentEntry,
} from '@scriptorium/content-schema'
import {
  computeSheet,
  createAggregate,
  createRulesetProfile,
  createSnapshot,
  planAction,
  type ActionContext,
  type ActionPlan,
  type ActionRef,
  type CharacterAggregate,
  type ComputedSheet,
  type ContentSnapshot,
  type RulesetProfile,
} from '@scriptorium/rules-engine'

export type AutomationLevel = 'full' | 'partial' | 'manual' | 'pending' | 'none'

export type CaseResult = { name: string; ok: boolean; message?: string }

export type EntryReport = {
  uid: string
  kind: ContentEntry['kind']
  name: string
  /** Owning class, subclass or species for features; the item category for items. */
  category: string
  level: AutomationLevel
  violations: string[]
  cases: CaseResult[]
  /** Mechanics expressed as structured data only (weapons, armor, classes, spells, monsters). */
  structural: boolean
  verified: boolean
}

export type AlphaManifest = {
  classes: string[]
  subclasses: string[]
  species: string[]
  backgrounds: string[]
  feats: string[]
  items: string[]
  monsters: string[]
}

export type Loaded = {
  entries: ContentEntry[]
  snapshot: ContentSnapshot
  ruleset: RulesetProfile
  fixtures: Record<string, Record<string, unknown>>
  alpha: AlphaManifest
  allowlist: Array<{ uid: string; reason: string }>
}

const STRUCTURAL_KINDS = new Set<ContentEntry['kind']>([
  'class',
  'subclass',
  'species',
  'background',
  'spell',
  'spell_list',
  'monster',
  'condition',
  'rule',
  'resource',
])

export function loadContent(root: string): Loaded {
  const contentDir = join(root, 'content', 'srd-5.1')
  const entries: ContentEntry[] = []
  for (const file of readdirSync(contentDir)) {
    if (!file.endsWith('.package.json')) continue
    const pkg = contentPackageSchema.parse(JSON.parse(readFileSync(join(contentDir, file), 'utf8')))
    entries.push(...pkg.entries)
  }
  const ruleset = createRulesetProfile(
    rulesetConfigSchema.parse(
      JSON.parse(readFileSync(join(root, 'content', 'rulesets', 'srd5.1-2014.json'), 'utf8')),
    ),
  )
  const mechanics = join(contentDir, 'mechanics')
  const fixturesDir = join(mechanics, 'fixtures')
  const fixtures: Record<string, Record<string, unknown>> = {}
  if (existsSync(fixturesDir)) {
    for (const file of readdirSync(fixturesDir)) {
      if (!file.endsWith('.json')) continue
      fixtures[file.slice(0, -'.json'.length)] = JSON.parse(
        readFileSync(join(fixturesDir, file), 'utf8'),
      ) as Record<string, unknown>
    }
  }
  const alpha = JSON.parse(readFileSync(join(mechanics, 'alpha.json'), 'utf8')) as AlphaManifest
  const allowlist = JSON.parse(
    readFileSync(join(mechanics, 'manual-allowlist.json'), 'utf8'),
  ) as Array<{ uid: string; reason: string }>
  return { entries, snapshot: createSnapshot(entries), ruleset, fixtures, alpha, allowlist }
}

export function categoryOf(entry: ContentEntry): string {
  switch (entry.kind) {
    case 'feature':
      return entry.data.owner ?? 'feature:unowned'
    case 'item':
      return `item:${entry.data.category}`
    default:
      return entry.kind
  }
}

function isStructural(entry: ContentEntry): boolean {
  if (entry.kind === 'item') {
    const data = entry.data
    return (
      Boolean(data.weapon || data.armor || data.charges || data.category === 'shield') &&
      entry.effects.length === 0 &&
      entry.choices.length === 0
    )
  }
  return STRUCTURAL_KINDS.has(entry.kind)
}

/** Declaration checks (docs/RULES_ENGINE.md §9). */
export function declarationViolations(entry: ContentEntry): string[] {
  const level = entry.automation?.level ?? 'none'
  const mechanical = entry.effects.filter((e) => e.type !== 'manual').length + entry.choices.length
  const violations: string[] = []
  if (level === 'full' && entry.effects.some((e) => e.type === 'manual'))
    violations.push('full automation includes a manual effect')
  if ((level === 'full' || level === 'partial') && mechanical === 0 && !isStructural(entry))
    violations.push(`${level} automation without mechanical effects or choices`)
  if (level === 'partial' && !(entry.automation?.manualParts?.length ?? 0))
    violations.push('partial automation without manualParts')
  if (level === 'manual' && mechanical > 0)
    violations.push('manual automation with mechanical effects or choices')
  return violations
}

export function runConformance(loaded: Loaded): EntryReport[] {
  const reports: EntryReport[] = []
  for (const entry of loaded.entries) {
    const level = (entry.automation?.level ?? 'none') as AutomationLevel
    const violations = declarationViolations(entry)
    const structural =
      isStructural(entry) && entry.effects.length === 0 && entry.choices.length === 0
    const cases =
      level === 'full' || level === 'partial'
        ? entry.tests.map((c, i) => runCase(c, i, loaded))
        : []
    const verified =
      violations.length === 0 &&
      (level === 'full' || level === 'partial') &&
      (cases.length > 0 ? cases.every((c) => c.ok) : structural)
    reports.push({
      uid: entry.uid,
      kind: entry.kind,
      name: entry.name,
      category: categoryOf(entry),
      level,
      violations,
      cases,
      structural,
      verified,
    })
  }
  return reports
}

export function runCase(c: BehaviouralCase, index: number, loaded: Loaded): CaseResult {
  const name = c.name ?? `case ${index + 1}`
  const fail = (message: string): CaseResult => ({ name, ok: false, message })
  const fixture = loaded.fixtures[c.given.fixture]
  if (!fixture) return fail(`unknown fixture "${c.given.fixture}"`)
  let aggregate: CharacterAggregate
  let sheet: ComputedSheet
  try {
    const merged = c.given.modify ? deepMerge(fixture, c.given.modify) : fixture
    aggregate = createAggregate(merged as Parameters<typeof createAggregate>[0])
    sheet = computeSheet(aggregate, loaded.snapshot, loaded.ruleset)
  } catch (error) {
    return fail(`engine threw: ${(error as Error).message}`)
  }
  const e = c.expect
  if ('stat' in e) {
    const value = sheet.stats[e.stat]?.value
    if (e.equals !== undefined) {
      const actual = value === undefined && typeof e.equals === 'boolean' ? false : value
      return actual === e.equals
        ? { name, ok: true }
        : fail(`${e.stat} is ${JSON.stringify(value)}, expected ${JSON.stringify(e.equals)}`)
    }
    if (e.atLeast !== undefined) {
      return typeof value === 'number' && value >= e.atLeast
        ? { name, ok: true }
        : fail(`${e.stat} is ${JSON.stringify(value)}, expected at least ${e.atLeast}`)
    }
    if (e.contains !== undefined) {
      const ok = Array.isArray(value)
        ? (value as unknown[]).includes(e.contains)
        : typeof value === 'string' && value.includes(String(e.contains))
      return ok
        ? { name, ok: true }
        : fail(
            `${e.stat} (${JSON.stringify(value)}) does not contain ${JSON.stringify(e.contains)}`,
          )
    }
    return fail('stat expectation needs equals, atLeast or contains')
  }
  if ('actionPlan' in e) {
    let plan: ActionPlan
    try {
      plan = planAction(
        sheet,
        aggregate,
        e.actionPlan.ref as ActionRef,
        e.actionPlan.ctx as ActionContext,
        loaded.snapshot,
      )
    } catch (error) {
      return fail(`planAction threw: ${(error as Error).message}`)
    }
    const summary = summarize(plan)
    if (e.contains && !subset(summary, e.contains))
      return fail(
        `plan does not contain ${JSON.stringify(e.contains)}; plan: ${JSON.stringify(summary)}`,
      )
    if (e.excludes && !excludes(summary, e.excludes))
      return fail(
        `plan contains excluded ${JSON.stringify(e.excludes)}; plan: ${JSON.stringify(summary)}`,
      )
    return { name, ok: true }
  }
  if ('proficient' in e) {
    const ok = sheet.proficiencies[e.proficient.set].some((p) => p.id === e.proficient.id)
    return ok
      ? { name, ok: true }
      : fail(
          `${e.proficient.set} do not include ${e.proficient.id}: ${sheet.proficiencies[e.proficient.set].map((p) => p.id).join(', ')}`,
        )
  }
  if ('knownSpell' in e) {
    const known =
      sheet.spellcasting?.known.some((k) => k.spellUid === e.knownSpell) ||
      sheet.spellcasting?.granted.some((g) => g.spellUid === e.knownSpell)
    return known ? { name, ok: true } : fail(`${e.knownSpell} is not known or granted`)
  }
  if ('defense' in e) {
    const ok = sheet.defenses.some(
      (d) => d.kind === e.defense.kind && d.damageType === e.defense.damageType,
    )
    return ok ? { name, ok: true } : fail(`no ${e.defense.kind} to ${e.defense.damageType}`)
  }
  if ('command' in e) return fail('command cases are executed from M2.5')
  return fail('unknown expectation')
}

/** The plan facts a behavioural case may match. */
export function summarize(plan: ActionPlan): Record<string, unknown> {
  return {
    name: plan.name,
    actionType: plan.actionType,
    blocked: plan.blocked ?? null,
    damageIds: plan.damage.map((d) => d.id),
    damage: plan.damage.map((d) => ({
      id: d.id,
      formula: d.formula,
      critFormula: d.critFormula,
      damageType: d.damageType,
      ...(d.oncePerTurnKey ? { oncePerTurnKey: d.oncePerTurnKey } : {}),
    })),
    excluded: plan.excluded.map((x) => x.id),
    questions: plan.questions.map((q) => q.id),
    oncePerTurnKeys: plan.oncePerTurnKeys,
    costs: plan.costs,
    riders: plan.riders.map((r) => r.text),
    economy: plan.economy,
    ...(plan.save ? { save: plan.save } : {}),
    ...(plan.healing !== undefined ? { healing: plan.healing } : {}),
    ...(plan.concentration ? { concentration: true } : {}),
    ...(plan.attack
      ? {
          attack: {
            bonus: plan.attack.bonus,
            mode: plan.attack.mode,
            critRange: plan.attack.critRange,
            attackType: plan.attack.attackType,
          },
        }
      : {}),
    ...(plan.save ? { save: plan.save } : {}),
    ...(plan.check ? { check: { bonus: plan.check.bonus, mode: plan.check.mode } } : {}),
    ...(plan.healing !== undefined ? { healing: plan.healing } : {}),
    concentration: plan.concentration ?? false,
  }
}

/** `expected` is contained in `actual`: objects by key, arrays element-wise (each expected element matches some actual element). */
export function subset(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false
    return expected.every((e) => actual.some((a) => subset(a, e)))
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
    return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
      subset((actual as Record<string, unknown>)[k], v),
    )
  }
  return actual === expected
}

/** None of the expected values appear: arrays by element, objects by key. */
export function excludes(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return true
    return expected.every((e) => !actual.some((a) => subset(a, e)))
  }
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') return true
    return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
      excludes((actual as Record<string, unknown>)[k], v),
    )
  }
  return actual !== expected
}

export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a }
  for (const [key, value] of Object.entries(b)) {
    const existing = out[key]
    if (isPlainObject(existing) && isPlainObject(value)) out[key] = deepMerge(existing, value)
    else out[key] = value
  }
  return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
