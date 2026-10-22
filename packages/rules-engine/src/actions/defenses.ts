import { DAMAGE_TYPES, type MonsterData, type Predicate } from '@scriptorium/content-schema'
import type { PacketFlags, TargetDefense } from './types.js'

const TYPE_SET = new Set<string>(DAMAGE_TYPES)
const PHYSICAL = ['bludgeoning', 'piercing', 'slashing'] as const

/**
 * Turns the SRD stat-block defense text into structured defenses with packet-scope conditions.
 * Lines it cannot read are returned in `unparsed` so the table can apply them by hand.
 */
export function parseDefenseText(
  kind: TargetDefense['kind'],
  text: string,
): { defenses: TargetDefense[]; unparsed?: string } {
  const lower = text.trim().toLowerCase()
  if (TYPE_SET.has(lower)) return { defenses: [{ kind, damageType: lower }] }

  if (lower === 'damage from spells') {
    return {
      defenses: DAMAGE_TYPES.map((damageType) => ({
        kind,
        damageType,
        condition: { leaf: 'packet.fromSpell' },
        note: text,
      })),
    }
  }

  const nonmagical =
    /^(.*?) from nonmagical (?:weapons|attacks)(?: that aren't (silvered|adamantine))?/.exec(lower)
  if (nonmagical) {
    const types = listTypes(nonmagical[1]!)
    if (types.length > 0) {
      const exceptions: Predicate[] = [{ leaf: 'packet.magical' }]
      if (nonmagical[2] === 'silvered') exceptions.push({ leaf: 'packet.silvered' })
      if (nonmagical[2] === 'adamantine') exceptions.push({ leaf: 'packet.adamantine' })
      const condition: Predicate = { not: { any: exceptions } }
      return { defenses: types.map((damageType) => ({ kind, damageType, condition, note: text })) }
    }
  }

  const plain = listTypes(lower)
  if (
    plain.length > 0 &&
    plain.length === lower.split(/,|\band\b/).filter((s) => s.trim()).length
  ) {
    return { defenses: plain.map((damageType) => ({ kind, damageType })) }
  }
  return { defenses: [], unparsed: text }
}

function listTypes(text: string): string[] {
  const out: string[] = []
  for (const part of text.split(/,|\band\b/)) {
    const word = part.trim()
    if (TYPE_SET.has(word)) out.push(word)
  }
  return out.length === 0 && PHYSICAL.every((p) => text.includes(p)) ? [...PHYSICAL] : out
}

/** Structured defenses for a monster stat block plus the lines that need manual handling. */
export function monsterDefenses(
  data: Pick<MonsterData, 'damageVulnerabilities' | 'damageResistances' | 'damageImmunities'>,
): {
  defenses: TargetDefense[]
  unparsed: string[]
} {
  const defenses: TargetDefense[] = []
  const unparsed: string[] = []
  const add = (kind: TargetDefense['kind'], lines: string[]) => {
    for (const line of lines) {
      const parsed = parseDefenseText(kind, line)
      defenses.push(...parsed.defenses)
      if (parsed.unparsed) unparsed.push(parsed.unparsed)
    }
  }
  add('vulnerability', data.damageVulnerabilities)
  add('resistance', data.damageResistances)
  add('immunity', data.damageImmunities)
  return { defenses, unparsed }
}

type PacketLeaf = Extract<Predicate, { leaf: `packet.${string}` }>

/** Evaluates a packet-scope predicate against a packet's flags; static leaves need `isStatic`. */
export function evaluatePacketPredicate(
  predicate: Predicate,
  flags: PacketFlags,
  damageType: string,
  isStatic: (
    leaf: Exclude<Predicate, { all: unknown } | { any: unknown } | { not: unknown } | PacketLeaf>,
  ) => boolean,
): boolean {
  if ('all' in predicate)
    return predicate.all.every((p) => evaluatePacketPredicate(p, flags, damageType, isStatic))
  if ('any' in predicate)
    return predicate.any.some((p) => evaluatePacketPredicate(p, flags, damageType, isStatic))
  if ('not' in predicate)
    return !evaluatePacketPredicate(predicate.not, flags, damageType, isStatic)
  switch (predicate.leaf) {
    case 'packet.magical':
      return flags.magical
    case 'packet.silvered':
      return flags.silvered
    case 'packet.adamantine':
      return flags.adamantine
    case 'packet.fromSpell':
      return flags.fromSpell
    case 'packet.type':
      return (predicate.types as string[]).includes(damageType)
    default:
      return isStatic(predicate as Parameters<typeof isStatic>[0])
  }
}
