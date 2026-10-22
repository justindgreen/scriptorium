import { afterAll, describe, expect, it } from 'vitest'
import { computeSheet, type ComputedSheet } from '../src/index.js'
import {
  buildAggregate,
  buildSnapshot,
  loadGoldenCases,
  loadRuleset,
  type GoldenExpectations,
} from './helpers/golden.js'

/** Golden regression cases (docs/TEST_STRATEGY.md §2) for the static sheet. */
const ruleset = loadRuleset()
const cases = loadGoldenCases()
let assertions = 0

function check(sheet: ComputedSheet, e: GoldenExpectations, label: string) {
  for (const [path, expected] of Object.entries(e.expectSheet ?? {})) {
    assertions += 1
    expect(sheet.stats[path]?.value, `${label}: ${path}`).toEqual(expected)
  }
  for (const [path, flag] of Object.entries(e.expectError ?? {})) {
    assertions += 1
    expect(sheet.stats[path]?.error === true, `${label}: ${path} error`).toBe(flag)
  }
  for (const [path, o] of Object.entries(e.expectOverride ?? {})) {
    assertions += 1
    expect(sheet.stats[path]?.override, `${label}: ${path} override`).toMatchObject(o)
  }
  for (const [path, b] of Object.entries(e.expectBreakdown ?? {})) {
    const lines = sheet.stats[path]?.breakdown ?? []
    const labelOf = (l: (typeof lines)[number]) => l.label ?? l.source.name
    if (b.applied) {
      assertions += 1
      expect(lines.filter((l) => l.applied).map(labelOf), `${label}: ${path} applied`).toEqual(
        expect.arrayContaining(b.applied),
      )
    }
    if (b.lost) {
      assertions += 1
      expect(lines.filter((l) => !l.applied).map(labelOf), `${label}: ${path} lost`).toEqual(
        expect.arrayContaining(b.lost),
      )
    }
  }
  for (const d of e.expectDiagnostics ?? []) {
    assertions += 1
    const found = sheet.diagnostics.find(
      (x) =>
        x.code === d.code &&
        (d.statPath === undefined || x.statPath === d.statPath) &&
        (d.severity === undefined || x.severity === d.severity),
    )
    expect(
      found,
      `${label}: diagnostic ${d.code} ${d.statPath ?? ''}\n${sheet.diagnostics.map((x) => `${x.code} ${x.statPath ?? ''}: ${x.message}`).join('\n')}`,
    ).toBeDefined()
  }
  for (const code of e.expectNoDiagnostics ?? []) {
    assertions += 1
    expect(
      sheet.diagnostics.filter((x) => x.code === code).map((x) => x.message),
      `${label}: no ${code}`,
    ).toEqual([])
  }
  for (const p of e.expectPendingChoices ?? []) {
    assertions += 1
    const found = sheet.pendingChoices.find((x) => x.key === p.key)
    expect(
      found?.remaining,
      `${label}: pending ${p.key}\n${sheet.pendingChoices.map((x) => x.key).join('\n')}`,
    ).toBe(p.remaining)
    if (p.options !== undefined) {
      assertions += 1
      expect(found?.options?.length, `${label}: options of ${p.key}`).toBe(p.options)
    }
    if (p.disabled) {
      assertions += 1
      expect(
        found?.options?.filter((o) => o.disabledReason).map((o) => o.id),
        `${label}: disabled options of ${p.key}`,
      ).toEqual(p.disabled)
    }
  }
  if (e.expectNoPendingChoices) {
    assertions += 1
    expect(
      sheet.pendingChoices.map((p) => p.key),
      `${label}: no pending choices`,
    ).toEqual([])
  }
  for (const [set, ids] of Object.entries(e.expectProficiencies ?? {})) {
    assertions += 1
    const actual = sheet.proficiencies[set as keyof ComputedSheet['proficiencies']].map((p) => p.id)
    expect(actual, `${label}: proficiencies.${set}`).toEqual(expect.arrayContaining(ids))
  }
  for (const t of e.expectTemplates ?? []) {
    const found = sheet.actionTemplates.find((x) => x.name === t.name)
    assertions += 1
    expect(
      found,
      `${label}: template ${t.name}\n${sheet.actionTemplates.map((x) => x.name).join(', ')}`,
    ).toBeDefined()
    if (!found) continue
    if (t.attackBonus !== undefined) {
      assertions += 1
      expect(found.attack?.bonus, `${label}: ${t.name} attack`).toBe(t.attackBonus)
    }
    if (t.damage) {
      assertions += 1
      expect(
        found.damage.map((d) => d.text),
        `${label}: ${t.name} damage`,
      ).toEqual(t.damage)
    }
    if (t.healing !== undefined) {
      assertions += 1
      expect(found.healing, `${label}: ${t.name} healing`).toBe(t.healing)
    }
    if (t.riders !== undefined) {
      assertions += 1
      expect(found.riders.length, `${label}: ${t.name} riders`).toBe(t.riders)
    }
    if (t.properties) {
      assertions += 1
      expect(found.properties, `${label}: ${t.name} properties`).toEqual(
        expect.arrayContaining(t.properties),
      )
    }
  }
  for (const r of e.expectResources ?? []) {
    assertions += 1
    const found = sheet.resources.find((x) => x.id === r.id)
    expect(found?.max.value, `${label}: resource ${r.id}`).toBe(r.max)
    if (r.current !== undefined) {
      assertions += 1
      expect(found?.current, `${label}: resource ${r.id} current`).toBe(r.current)
    }
  }
  if (e.expectDefenses) {
    assertions += 1
    expect(
      sheet.defenses.map((d) => ({ kind: d.kind, damageType: d.damageType })),
      `${label}: defenses`,
    ).toEqual(expect.arrayContaining(e.expectDefenses))
  }
  for (const t of e.expectToggles ?? []) {
    assertions += 1
    expect(sheet.toggles.find((x) => x.id === t.id)?.active, `${label}: toggle ${t.id}`).toBe(
      t.active,
    )
  }
  if (e.expectHitDice) {
    assertions += 1
    expect(
      sheet.hitDice.map((h) => ({ die: h.die, max: h.max })),
      `${label}: hit dice`,
    ).toEqual(e.expectHitDice)
  }
  if (e.expectFeatures) {
    assertions += 1
    expect(
      sheet.features.map((f) => f.uid),
      `${label}: features`,
    ).toEqual(expect.arrayContaining(e.expectFeatures))
  }
}

describe('golden sheets', () => {
  for (const golden of cases) {
    describe(golden.name, () => {
      const snapshot = buildSnapshot(
        golden.snapshotRefs ?? [],
        golden.contentFiles ?? [],
        golden.content ?? [],
      )

      it('matches the expected sheet and is deterministic', () => {
        const aggregate = buildAggregate(golden.aggregate)
        const sheet = computeSheet(aggregate, snapshot, ruleset)
        check(sheet, golden, golden.name)
        const again = computeSheet(buildAggregate(golden.aggregate), snapshot, ruleset)
        expect(JSON.stringify(again)).toBe(JSON.stringify(sheet))
        // Storage order must not matter: reverse the inventory and the temporary effects.
        const shuffled = buildAggregate(golden.aggregate)
        shuffled.inventory = [...shuffled.inventory].reverse()
        shuffled.state.activeEffects = [...shuffled.state.activeEffects].reverse()
        const sheetShuffled = computeSheet(shuffled, snapshot, ruleset)
        for (const [path, stat] of Object.entries(sheet.stats)) {
          expect(
            sheetShuffled.stats[path]?.value,
            `${golden.name}: ${path} independent of storage order`,
          ).toEqual(stat.value)
        }
      })

      for (const variant of golden.variants ?? []) {
        it(variant.name, () => {
          const aggregate = buildAggregate(golden.aggregate, variant.aggregate)
          const sheet = computeSheet(aggregate, snapshot, ruleset)
          check(sheet, variant, `${golden.name} / ${variant.name}`)
        })
      }
    })
  }

  afterAll(() => {
    // The M2.2 criterion: at least 60 golden assertions on hand-built aggregates.
    expect(assertions).toBeGreaterThanOrEqual(60)
    console.log(`golden assertions: ${assertions} across ${cases.length} cases`)
  })
})
