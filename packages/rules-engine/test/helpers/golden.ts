import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  contentEntrySchema,
  rulesetConfigSchema,
  type ContentEntry,
} from '@scriptorium/content-schema'
import {
  createAggregate,
  createRulesetProfile,
  createSnapshot,
  type CharacterAggregate,
  type ContentSnapshot,
  type RulesetProfile,
} from '../../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
const contentDir = join(repoRoot, 'content', 'srd-5.1')
const goldenDir = join(here, '..', 'golden')

let srdIndex: Map<string, unknown> | undefined

/** Raw SRD entries by uid from the committed packages (parsed lazily, once). */
export function srdEntries(): Map<string, unknown> {
  if (srdIndex) return srdIndex
  srdIndex = new Map()
  for (const file of readdirSync(contentDir)) {
    if (!file.endsWith('.package.json')) continue
    const pkg = JSON.parse(readFileSync(join(contentDir, file), 'utf8')) as {
      entries: Array<{ uid: string }>
    }
    for (const entry of pkg.entries) srdIndex.set(entry.uid, entry)
  }
  return srdIndex
}

export function loadRuleset(): RulesetProfile {
  const raw = JSON.parse(
    readFileSync(join(repoRoot, 'content', 'rulesets', 'srd5.1-2014.json'), 'utf8'),
  )
  return createRulesetProfile(rulesetConfigSchema.parse(raw))
}

/**
 * Builds a snapshot from SRD uids plus inline entries (from shared `_*.json` files and the case
 * itself). Inline entries override SRD entries with the same uid, which is how mechanics overlays
 * work in production content. Every inline entry must pass the content schema.
 */
export function buildSnapshot(
  refs: string[],
  contentFiles: string[],
  inline: unknown[],
): ContentSnapshot {
  const entries: ContentEntry[] = []
  const index = srdEntries()
  for (const uid of refs) {
    const raw = index.get(uid)
    if (!raw) throw new Error(`golden fixture references unknown SRD uid ${uid}`)
    entries.push(contentEntrySchema.parse(raw))
  }
  for (const file of contentFiles) {
    const raw = JSON.parse(readFileSync(join(goldenDir, file), 'utf8')) as unknown[]
    for (const entry of raw) entries.push(contentEntrySchema.parse(entry))
  }
  for (const raw of inline) entries.push(contentEntrySchema.parse(raw))
  return createSnapshot(entries)
}

export type GoldenExpectations = {
  expectSheet?: Record<string, unknown>
  expectError?: Record<string, boolean>
  expectOverride?: Record<string, { auto: unknown; manual: unknown; note?: string }>
  expectBreakdown?: Record<string, { applied?: string[]; lost?: string[] }>
  expectDiagnostics?: Array<{ code: string; statPath?: string; severity?: string }>
  expectNoDiagnostics?: string[]
  expectPendingChoices?: Array<{
    key: string
    remaining: number
    options?: number
    disabled?: string[]
  }>
  expectNoPendingChoices?: boolean
  expectProficiencies?: Partial<Record<'armor' | 'weapons' | 'tools' | 'languages', string[]>>
  expectTemplates?: Array<{
    name: string
    attackBonus?: number
    damage?: string[]
    healing?: string
    riders?: number
    properties?: string[]
  }>
  expectResources?: Array<{ id: string; max: number; current?: number }>
  expectDefenses?: Array<{ kind: string; damageType: string }>
  expectToggles?: Array<{ id: string; active: boolean }>
  expectHitDice?: Array<{ die: string; max: number }>
  expectFeatures?: string[]
}

export type GoldenCase = GoldenExpectations & {
  name: string
  ruleset: string
  snapshotRefs?: string[]
  contentFiles?: string[]
  content?: unknown[]
  aggregate: Partial<CharacterAggregate> & {
    definition?: Record<string, unknown>
    state?: Record<string, unknown>
  }
  variants?: Array<GoldenExpectations & { name: string; aggregate?: Record<string, unknown> }>
}

/** Every `*.json` in test/golden except shared content files, which start with `_`. */
export function loadGoldenCases(): GoldenCase[] {
  return readdirSync(goldenDir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(goldenDir, f), 'utf8')) as GoldenCase)
}

export function buildAggregate(
  base: GoldenCase['aggregate'],
  patch?: Record<string, unknown>,
): CharacterAggregate {
  const merged = patch ? deepMerge(base as Record<string, unknown>, patch) : base
  return createAggregate(merged as Parameters<typeof createAggregate>[0])
}

/** Objects merge recursively; arrays and scalars replace. */
function deepMerge(
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
