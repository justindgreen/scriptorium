import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { monsterDefenses } from '@scriptorium/rules-engine'
import { alphaGate, summarize } from '../src/report.js'
import { loadContent, runConformance } from '../src/run.js'

/** Alpha gate (docs/TEST_STRATEGY.md §4) over the committed packages and overlays. */
const root = join(import.meta.dirname, '..', '..', '..')
const loaded = loadContent(root)
const reports = runConformance(loaded)
const gate = alphaGate(loaded, reports)

describe('conformance: declarations and behavioural cases', () => {
  it('has no declaration violations anywhere', () => {
    const violations = reports
      .filter((r) => r.violations.length > 0)
      .map((r) => `${r.uid}: ${r.violations.join('; ')}`)
    expect(violations).toEqual([])
  })

  it('every behavioural case passes', () => {
    const failures = reports.flatMap((r) =>
      r.cases.filter((c) => !c.ok).map((c) => `${r.uid} / ${c.name}: ${c.message}`),
    )
    expect(failures).toEqual([])
  })

  it('verifies 100% of the alpha full/partial entries', () => {
    expect(gate.unverified.map((r) => r.uid)).toEqual([])
    expect(gate.verifiedShare).toBe(1)
  })

  it('lists every manual alpha feature on the allow-list with a reason', () => {
    expect(gate.manualOffList.map((r) => r.uid)).toEqual([])
    for (const a of loaded.allowlist) expect(a.reason.length).toBeGreaterThan(3)
  })

  it('leaves no alpha entry pending', () => {
    expect(gate.pending.map((r) => r.uid)).toEqual([])
  })

  it('reports the full-or-partial share of alpha class and subclass features (gate ≥ 95% is an owner decision at Gate A1)', () => {
    const s = gate.classFeatures
    console.log(
      `alpha class/subclass features: ${s.total} total, ${s.full} full, ${s.partial} partial, ${s.manual} manual -> ${Math.round(gate.fullOrPartialShare * 1000) / 10}% full or partial; ${Math.round(gate.fullOrPartialShareMechanical * 1000) / 10}% excluding ${gate.placeholders} placeholder rows`,
    )
    // Measured baseline at M2.4; a drop below it is a regression. The 95% gate itself is not met
    // because the remaining manual features are narrative or table-adjudicated (see the allow-list).
    expect(gate.fullOrPartialShareMechanical).toBeGreaterThanOrEqual(0.78)
    expect(s.manual + s.pending + s.none).toBe(s.total - s.full - s.partial)
  })

  it('reports totals', () => {
    const total = summarize(reports)
    console.log(`all content: ${JSON.stringify(total)}; alpha: ${JSON.stringify(gate.features)}`)
    expect(total.total).toBeGreaterThan(1900)
  })
})

describe('alpha spell lists and monsters', () => {
  it('cleric and warlock lists have spells at every level 0-9', () => {
    for (const list of ['srd-5.1:spell_list:cleric', 'srd-5.1:spell_list:warlock']) {
      const entry = loaded.snapshot.get(list)
      expect(entry?.kind).toBe('spell_list')
      if (entry?.kind !== 'spell_list') continue
      const byLevel = new Map<number, number>()
      for (const uid of entry.data.spells) {
        const spell = loaded.snapshot.get(uid)
        expect(spell?.kind, uid).toBe('spell')
        if (spell?.kind === 'spell')
          byLevel.set(spell.data.level, (byLevel.get(spell.data.level) ?? 0) + 1)
      }
      for (let level = 0; level <= 9; level += 1)
        expect(byLevel.get(level) ?? 0, `${list} level ${level}`).toBeGreaterThan(0)
    }
  })

  it('the twelve alpha monsters have structured attacks and parseable defenses', () => {
    for (const uid of loaded.alpha.monsters) {
      const monster = loaded.snapshot.get(uid)
      expect(monster?.kind, uid).toBe('monster')
      if (monster?.kind !== 'monster') continue
      const attacks = monster.data.actions.filter(
        (a) => a.attack && a.damage.length > 0 && a.damage.every((d) => /^\d+d\d+/.test(d.dice)),
      )
      expect(attacks.length, `${uid} attacks with to-hit and damage dice`).toBeGreaterThan(0)
      const defenses = monsterDefenses(monster.data)
      expect(defenses.unparsed, `${uid} defenses`).toEqual([])
      expect(monster.data.armorClass.length).toBeGreaterThan(0)
      expect(monster.data.hitPoints.average).toBeGreaterThan(0)
    }
  })
})
