import type {
  ContentEntry,
  ContentEntryOf,
  ContentKind,
  RulesetConfig,
} from '@scriptorium/content-schema'
import type { ContentSnapshot, RulesetProfile } from './types.js'

/** Builds a snapshot from already-validated entries (the server parses `content_versions` first). */
export function createSnapshot(entries: Iterable<ContentEntry>): ContentSnapshot {
  const map = new Map<string, ContentEntry>()
  for (const entry of entries) map.set(entry.uid, entry)
  return {
    get: (uid) => map.get(uid),
    has: (uid) => map.has(uid),
    entries: () => [...map.values()],
  }
}

/** Returns the entry when it exists and has the expected kind. */
export function entryOfKind<K extends ContentKind>(
  snapshot: ContentSnapshot,
  uid: string,
  kind: K,
): ContentEntryOf<K> | undefined {
  const entry = snapshot.get(uid)
  return entry && entry.kind === kind ? (entry as ContentEntryOf<K>) : undefined
}

/** Species chain from the root ancestor down to the leaf the character picked. */
export function speciesChain(
  snapshot: ContentSnapshot,
  leafUid: string,
): ContentEntryOf<'species'>[] {
  const chain: ContentEntryOf<'species'>[] = []
  const seen = new Set<string>()
  let current: string | undefined = leafUid
  while (current && !seen.has(current)) {
    seen.add(current)
    const entry: ContentEntryOf<'species'> | undefined = entryOfKind(snapshot, current, 'species')
    if (!entry) break
    chain.unshift(entry)
    current = entry.data.parent
  }
  return chain
}

export function createRulesetProfile(config: RulesetConfig): RulesetProfile {
  const table = config.proficiencyBonusByLevel
  return {
    config,
    proficiencyBonus: (level) => {
      if (level < 1) return table[0] ?? 2
      return table[Math.min(level, table.length) - 1] ?? table[table.length - 1] ?? 2
    },
    abilityScoreCap: config.abilityScoreCap,
  }
}
