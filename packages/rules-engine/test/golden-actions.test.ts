import { afterAll, describe, expect, it } from 'vitest'
import {
  applyRolls,
  computeSheet,
  planAction,
  type ActionContext,
  type ActionRef,
  type ComputedSheet,
  type RollInputs,
} from '../src/index.js'
import { buildAggregate, buildSnapshot, loadGoldenCases, loadRuleset } from './helpers/golden.js'

/** Golden action plans, outcomes and spellcasting views (docs/TEST_STRATEGY.md §2, M2.3). */
type PlanExpectation = {
  attack?: { bonus?: number; mode?: string; critRange?: number; attackType?: string }
  damage?: Array<{
    id: string
    formula?: string
    critFormula?: string
    damageType?: string
    oncePerTurnKey?: string
    magical?: boolean
  }>
  damageIds?: string[]
  excluded?: Array<{ id: string; reason: string }>
  questions?: string[]
  assumptions?: Array<{ id: string; value: unknown }>
  oncePerTurnKeys?: string[]
  costs?: Array<{ kind: string; level?: number; available?: number; sufficient?: boolean }>
  blocked?: string | null
  healing?: string
  save?: { ability: string; dc: number; onSuccess?: string }
  concentration?: boolean
  economy?: { available: boolean; reason?: string }
  properties?: string[]
}

type ActionCase = {
  name: string
  ref: ActionRef
  ctx?: ActionContext
  expectPlan?: PlanExpectation
  rolls?: RollInputs
  targetAc?: number
  expectOutcome?: {
    hit?: boolean | null
    critical?: boolean
    packets?: Array<{ id: string; amount: number }>
    oncePerTurnMarks?: string[]
    economyMark?: string
    healing?: number
  }
}

type SpellcastingExpectation = null | {
  casterLevel?: number
  slots?: Array<{ level: number; max: number; used?: number }>
  pact?: { slots: number; level: number } | null
  sources?: Array<{
    id: string
    saveDC?: number
    attack?: number
    preparedMax?: number
    cantripsKnown?: number
    spellsKnown?: number
  }>
  knownUids?: string[]
  alwaysPreparedUids?: string[]
  preparedCount?: number
  blocked?: string
}

type Extra = { actions?: ActionCase[]; expectSpellcasting?: SpellcastingExpectation }

const ruleset = loadRuleset()
let assertions = 0

function checkSpellcasting(sheet: ComputedSheet, expected: SpellcastingExpectation, label: string) {
  const view = sheet.spellcasting
  if (expected === null) {
    assertions += 1
    expect(view, `${label}: no spellcasting`).toBeNull()
    return
  }
  assertions += 1
  expect(view, `${label}: spellcasting`).not.toBeNull()
  if (!view) return
  if (expected.casterLevel !== undefined) {
    assertions += 1
    expect(view.casterLevel, `${label}: caster level`).toBe(expected.casterLevel)
  }
  if (expected.slots) {
    assertions += 1
    expect(
      view.slots.map((s) => ({ level: s.level, max: s.max, ...(s.used ? { used: s.used } : {}) })),
      `${label}: slots`,
    ).toEqual(
      expected.slots.map((s) => ({
        level: s.level,
        max: s.max,
        ...(s.used ? { used: s.used } : {}),
      })),
    )
  }
  if (expected.pact !== undefined) {
    assertions += 1
    expect(
      view.pact ? { slots: view.pact.slots, level: view.pact.level } : null,
      `${label}: pact`,
    ).toEqual(expected.pact)
  }
  for (const s of expected.sources ?? []) {
    assertions += 1
    const found = view.sources.find((x) => x.id === s.id)
    expect(found, `${label}: source ${s.id}`).toBeDefined()
    if (!found) continue
    const subset: Record<string, unknown> = {}
    for (const key of [
      'saveDC',
      'attack',
      'preparedMax',
      'cantripsKnown',
      'spellsKnown',
    ] as const) {
      if (s[key] !== undefined) subset[key] = s[key]
    }
    expect(found, `${label}: source ${s.id}`).toMatchObject(subset)
  }
  if (expected.knownUids) {
    assertions += 1
    expect(
      view.known.map((k) => k.spellUid),
      `${label}: known`,
    ).toEqual(expect.arrayContaining(expected.knownUids))
  }
  if (expected.alwaysPreparedUids) {
    assertions += 1
    expect(
      view.known.filter((k) => k.alwaysPrepared).map((k) => k.spellUid),
      `${label}: always prepared`,
    ).toEqual(expect.arrayContaining(expected.alwaysPreparedUids))
  }
  if (expected.preparedCount !== undefined) {
    assertions += 1
    expect(view.preparedCount, `${label}: prepared count`).toBe(expected.preparedCount)
  }
  if (expected.blocked !== undefined) {
    assertions += 1
    expect(view.blocked, `${label}: blocked`).toBe(expected.blocked)
  }
}

function checkAction(
  sheet: ComputedSheet,
  aggregate: Parameters<typeof planAction>[1],
  snapshot: Parameters<typeof planAction>[4],
  action: ActionCase,
  label: string,
) {
  const plan = planAction(sheet, aggregate, action.ref, action.ctx, snapshot)
  const e = action.expectPlan ?? {}
  const describePlan = () =>
    JSON.stringify({
      blocked: plan.blocked,
      damage: plan.damage.map((d) => d.id),
      questions: plan.questions.map((q) => q.id),
      diagnostics: plan.diagnostics.map((d) => d.message),
    })
  if (e.blocked !== undefined) {
    assertions += 1
    expect(plan.blocked ?? null, `${label}: blocked ${describePlan()}`).toBe(e.blocked)
  }
  if (e.attack) {
    assertions += 1
    expect(plan.attack, `${label}: attack ${describePlan()}`).toMatchObject(e.attack)
  }
  for (const d of e.damage ?? []) {
    assertions += 1
    const found = plan.damage.find((x) => x.id === d.id)
    expect(found, `${label}: packet ${d.id} ${describePlan()}`).toBeDefined()
    if (!found) continue
    const { magical, ...rest } = d
    expect(found, `${label}: packet ${d.id}`).toMatchObject(rest)
    if (magical !== undefined)
      expect(found.flags.magical, `${label}: packet ${d.id} magical`).toBe(magical)
  }
  if (e.damageIds) {
    assertions += 1
    expect(
      plan.damage.map((d) => d.id),
      `${label}: packet ids ${describePlan()}`,
    ).toEqual(e.damageIds)
  }
  if (e.excluded) {
    assertions += 1
    expect(
      plan.excluded.map((x) => ({ id: x.id, reason: x.reason })),
      `${label}: excluded`,
    ).toEqual(e.excluded)
  }
  if (e.questions) {
    assertions += 1
    expect(
      plan.questions.map((q) => q.id),
      `${label}: questions`,
    ).toEqual(e.questions)
  }
  if (e.assumptions) {
    assertions += 1
    expect(
      plan.assumptions.map((a) => ({ id: a.id, value: a.value })),
      `${label}: assumptions`,
    ).toEqual(e.assumptions)
  }
  if (e.oncePerTurnKeys) {
    assertions += 1
    expect(plan.oncePerTurnKeys, `${label}: once per turn keys`).toEqual(e.oncePerTurnKeys)
  }
  if (e.costs) {
    assertions += 1
    expect(plan.costs, `${label}: costs`).toMatchObject(e.costs)
    expect(plan.costs.length).toBe(e.costs.length)
  }
  if (e.healing !== undefined) {
    assertions += 1
    expect(plan.healing, `${label}: healing`).toBe(e.healing)
  }
  if (e.save) {
    assertions += 1
    expect(plan.save, `${label}: save`).toMatchObject(e.save)
  }
  if (e.concentration !== undefined) {
    assertions += 1
    expect(plan.concentration ?? false, `${label}: concentration`).toBe(e.concentration)
  }
  if (e.economy) {
    assertions += 1
    expect(plan.economy, `${label}: economy`).toMatchObject(e.economy)
  }
  if (action.rolls) {
    const outcome = applyRolls(
      plan,
      action.rolls,
      action.targetAc !== undefined ? { targetAc: action.targetAc } : {},
    )
    const o = action.expectOutcome ?? {}
    if (o.hit !== undefined) {
      assertions += 1
      expect(outcome.attack?.hit, `${label}: hit`).toBe(o.hit)
    }
    if (o.critical !== undefined) {
      assertions += 1
      expect(outcome.attack?.critical, `${label}: critical`).toBe(o.critical)
    }
    if (o.packets) {
      assertions += 1
      expect(
        outcome.packets.map((p) => ({ id: p.id, amount: p.amount })),
        `${label}: outcome packets`,
      ).toEqual(o.packets)
    }
    if (o.oncePerTurnMarks) {
      assertions += 1
      expect(outcome.oncePerTurnMarks, `${label}: marks`).toEqual(o.oncePerTurnMarks)
    }
    if (o.economyMark !== undefined) {
      assertions += 1
      expect(outcome.economyMark, `${label}: economy mark`).toBe(o.economyMark)
    }
    if (o.healing !== undefined) {
      assertions += 1
      expect(outcome.healing, `${label}: healing`).toBe(o.healing)
    }
  }
  // Plans are pure: the same inputs give the same plan.
  const again = planAction(sheet, aggregate, action.ref, action.ctx, snapshot)
  expect(JSON.stringify(again)).toBe(JSON.stringify(plan))
}

describe('golden actions and spellcasting', () => {
  for (const golden of loadGoldenCases()) {
    const extra = golden as typeof golden & Extra
    const variants = (golden.variants ?? []) as Array<
      (typeof golden.variants extends Array<infer V> | undefined ? V : never) & Extra
    >
    const relevant =
      extra.actions ||
      extra.expectSpellcasting !== undefined ||
      variants.some((v) => v.actions || v.expectSpellcasting !== undefined)
    if (!relevant) continue
    describe(golden.name, () => {
      const snapshot = buildSnapshot(
        golden.snapshotRefs ?? [],
        golden.contentFiles ?? [],
        golden.content ?? [],
      )
      it('base', () => {
        const aggregate = buildAggregate(golden.aggregate)
        const sheet = computeSheet(aggregate, snapshot, ruleset)
        if (extra.expectSpellcasting !== undefined)
          checkSpellcasting(sheet, extra.expectSpellcasting, golden.name)
        for (const action of extra.actions ?? [])
          checkAction(sheet, aggregate, snapshot, action, `${golden.name} / ${action.name}`)
      })
      for (const variant of variants) {
        if (!variant.actions && variant.expectSpellcasting === undefined) continue
        it(variant.name, () => {
          const aggregate = buildAggregate(golden.aggregate, variant.aggregate)
          const sheet = computeSheet(aggregate, snapshot, ruleset)
          if (variant.expectSpellcasting !== undefined)
            checkSpellcasting(sheet, variant.expectSpellcasting, `${golden.name} / ${variant.name}`)
          for (const action of variant.actions ?? [])
            checkAction(
              sheet,
              aggregate,
              snapshot,
              action,
              `${golden.name} / ${variant.name} / ${action.name}`,
            )
        })
      }
    })
  }

  afterAll(() => {
    console.log(`golden action and spellcasting assertions: ${assertions}`)
  })
})
