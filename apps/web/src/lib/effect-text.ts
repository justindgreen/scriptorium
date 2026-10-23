import { uidLabel } from '@/lib/characters'

/** Stat paths the item editor offers, with the words a player would use. */
export const STAT_LABELS: Record<string, string> = {
  'attack.weapon.self': 'attack rolls with this weapon',
  'damage.weapon.self': 'damage rolls with this weapon',
  'ac.bonus': 'armor class',
  'attack.melee': 'all melee attack rolls',
  'attack.ranged': 'all ranged attack rolls',
  'attack.spell': 'spell attack rolls',
  'spell.saveDC': 'spell save DC',
  'initiative.bonus': 'initiative',
  'speed.walk': 'walking speed (feet)',
  'hp.max': 'hit point maximum',
  'save.str.bonus': 'Strength saving throws',
  'save.dex.bonus': 'Dexterity saving throws',
  'save.con.bonus': 'Constitution saving throws',
  'save.int.bonus': 'Intelligence saving throws',
  'save.wis.bonus': 'Wisdom saving throws',
  'save.cha.bonus': 'Charisma saving throws',
}

type Loose = Record<string, unknown> & { type: string }

function signed(value: unknown): string {
  if (typeof value === 'number') return value >= 0 ? `+${value}` : String(value)
  return String(value)
}

function labelFor(path: string): string {
  return STAT_LABELS[path] ?? path.replace(/\./g, ' ')
}

/**
 * One plain sentence per effect, for players reading an item on the sheet (issue #11) and for
 * the editor's summaries. Unknown effect types fall back to their type and settings; nothing here
 * computes a rule, it only words what the content declares.
 */
export function describeEffect(effect: Loose, spellName: (uid: string) => string = uidLabel) {
  switch (effect.type) {
    case 'bonus':
      return `${signed(effect.value)} to ${labelFor(String(effect.target))}${effect.note ? ` (${String(effect.note)})` : ''}`
    case 'action.damageAdd': {
      const condition = effect.condition as { leaf?: string; types?: string[] } | undefined
      const against = condition?.types?.length ? ` against ${condition.types.join(' or ')}` : ''
      return `${String(effect.formula)} extra ${String(effect.damageType)} damage${against}${effect.label ? ` (${String(effect.label)})` : ''}`
    }
    case 'spell.grant': {
      const uses = effect.uses as { max: unknown; recharge: string } | undefined
      const cost = effect.chargeCost
        ? ` (${String(effect.chargeCost)} charge${effect.chargeCost === 1 ? '' : 's'})`
        : uses
          ? ` (${String(uses.max)} per ${uses.recharge})`
          : effect.atWill
            ? ' (at will)'
            : ''
      return `grants ${spellName(String(effect.spell))}${cost}; casting it from the sheet is not automated yet`
    }
    case 'manual':
      return String(effect.text)
    case 'proficiency.grant':
      return `proficiency: ${String(effect.kind)} ${uidLabel(String(effect.target ?? ''))}`.trim()
    case 'language.grant':
      return `language: ${uidLabel(String(effect.language))}`
    case 'speed.bonus':
      return `${signed(effect.value)} feet of ${String(effect.mode ?? 'walking')} speed`
    case 'speed.set':
      return `${String(effect.mode ?? 'walking')} speed becomes ${String(effect.value)} feet`
    case 'sense.grant':
      return `${String(effect.sense)} ${String(effect.range ?? '')} feet`.trim()
    case 'damage.resistance':
      return `resistance to ${String(effect.damageType)} damage`
    case 'damage.immunity':
      return `immunity to ${String(effect.damageType)} damage`
    case 'condition.immunity':
      return `immune to ${uidLabel(String(effect.condition))}`
    default: {
      const settings = Object.entries(effect)
        .filter(([key]) => key !== 'type' && key !== 'condition')
        .map(
          ([key, value]) =>
            `${key} ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`,
        )
      return `${effect.type}${settings.length ? `: ${settings.join(', ')}` : ''}`
    }
  }
}
