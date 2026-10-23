/**
 * The Effect Builder's rows and their translation to content-schema effects (docs/CONTENT_FORMAT.md).
 * Rows cover what the thin slice needs: static bonuses, extra damage against creature types,
 * granted spells and manual text. Anything else an advanced author stored is kept as a raw row.
 */
import type { Effect } from '@scriptorium/content-schema'
import type { trpcClient } from '@/lib/trpc'

export type ItemDraft = Parameters<typeof trpcClient.homebrew.items.save.mutate>[0]['draft']
export type ItemData = ItemDraft['data']

export const RECHARGE_TIMES = ['dawn', 'dusk', 'longRest', 'shortRest', 'never'] as const
export const USE_RECHARGES = ['dawn', 'dusk', 'longRest', 'shortRest'] as const

export type BuilderRow =
  | { kind: 'bonus'; target: string; value: string; note: string }
  | {
      kind: 'extraDamage'
      formula: string
      damageType: string
      label: string
      creatureTypes: string[]
    }
  | {
      kind: 'grantedSpell'
      spell: string
      mode: 'charges' | 'uses' | 'atWill'
      chargeCost: string
      usesMax: string
      recharge: (typeof USE_RECHARGES)[number]
    }
  | { kind: 'manual'; text: string }
  | { kind: 'raw'; effect: Effect }

/** Stat paths the builder offers, with the words a player would use. */
export const BONUS_TARGETS: Array<{ path: string; label: string }> = [
  { path: 'attack.weapon.self', label: 'Attack rolls with this weapon' },
  { path: 'damage.weapon.self', label: 'Damage rolls with this weapon' },
  { path: 'ac.bonus', label: 'Armor class' },
  { path: 'attack.melee', label: 'All melee attack rolls' },
  { path: 'attack.ranged', label: 'All ranged attack rolls' },
  { path: 'attack.spell', label: 'Spell attack rolls' },
  { path: 'spell.saveDC', label: 'Spell save DC' },
  { path: 'initiative.bonus', label: 'Initiative' },
  { path: 'speed.walk', label: 'Walking speed (feet)' },
  { path: 'hp.max', label: 'Hit point maximum' },
  { path: 'save.str.bonus', label: 'Strength saving throws' },
  { path: 'save.dex.bonus', label: 'Dexterity saving throws' },
  { path: 'save.con.bonus', label: 'Constitution saving throws' },
  { path: 'save.int.bonus', label: 'Intelligence saving throws' },
  { path: 'save.wis.bonus', label: 'Wisdom saving throws' },
  { path: 'save.cha.bonus', label: 'Charisma saving throws' },
  { path: 'ability.str.score', label: 'Strength score' },
  { path: 'ability.dex.score', label: 'Dexterity score' },
  { path: 'ability.con.score', label: 'Constitution score' },
  { path: 'ability.int.score', label: 'Intelligence score' },
  { path: 'ability.wis.score', label: 'Wisdom score' },
  { path: 'ability.cha.score', label: 'Charisma score' },
]

export function newRow(kind: BuilderRow['kind']): BuilderRow {
  switch (kind) {
    case 'bonus':
      return { kind, target: 'attack.weapon.self', value: '1', note: '' }
    case 'extraDamage':
      return { kind, formula: '1d8', damageType: 'radiant', label: '', creatureTypes: [] }
    case 'grantedSpell':
      return { kind, spell: '', mode: 'charges', chargeCost: '1', usesMax: '1', recharge: 'dawn' }
    case 'manual':
      return { kind, text: '' }
    case 'raw':
      return { kind, effect: { type: 'manual', text: '' } }
  }
}

export function rowsToEffects(rows: BuilderRow[]): Effect[] {
  const effects: Effect[] = []
  for (const row of rows) {
    switch (row.kind) {
      case 'bonus':
        effects.push({
          type: 'bonus',
          target: row.target,
          value: Number(row.value),
          ...(row.note ? { note: row.note } : {}),
        })
        break
      case 'extraDamage':
        effects.push({
          type: 'action.damageAdd',
          formula: row.formula,
          damageType: row.damageType as Extract<Effect, { type: 'action.damageAdd' }>['damageType'],
          appliesTo: 'weapon.self',
          optional: false,
          ...(row.label ? { label: row.label } : {}),
          ...(row.creatureTypes.length > 0
            ? { condition: { leaf: 'ctx.targetType', types: row.creatureTypes as never } }
            : {}),
        })
        break
      case 'grantedSpell':
        effects.push({
          type: 'spell.grant',
          spell: row.spell,
          atWill: row.mode === 'atWill',
          ...(row.mode === 'charges' ? { chargeCost: Number(row.chargeCost) } : {}),
          ...(row.mode === 'uses'
            ? { uses: { max: Number(row.usesMax), recharge: row.recharge } }
            : {}),
        })
        break
      case 'manual':
        effects.push({ type: 'manual', text: row.text })
        break
      case 'raw':
        effects.push(row.effect)
        break
    }
  }
  return effects
}

/** The creature types of a plain target-type condition; [] when unconditional; null when it is anything else. */
function targetTypesOf(condition: unknown): string[] | null {
  if (!condition) return []
  const c = condition as { leaf?: unknown; types?: unknown }
  return c.leaf === 'ctx.targetType' && Array.isArray(c.types) ? (c.types as string[]) : null
}

export function effectsToRows(effects: Effect[]): BuilderRow[] {
  return effects.map((effect): BuilderRow => {
    if (effect.type === 'bonus' && typeof effect.value === 'number' && !effect.condition) {
      return {
        kind: 'bonus',
        target: effect.target,
        value: String(effect.value),
        note: effect.note ?? '',
      }
    }
    const types = effect.type === 'action.damageAdd' ? targetTypesOf(effect.condition) : null
    if (
      effect.type === 'action.damageAdd' &&
      typeof effect.formula === 'string' &&
      effect.damageType !== 'weapon' &&
      types !== null &&
      !effect.oncePerTurn
    ) {
      return {
        kind: 'extraDamage',
        formula: effect.formula,
        damageType: effect.damageType,
        label: effect.label ?? '',
        creatureTypes: types,
      }
    }
    if (effect.type === 'spell.grant' && !effect.condition) {
      const uses = effect.uses
      const usesMax = uses && typeof uses.max === 'number' ? uses.max : null
      const recharge = uses?.recharge
      if (!uses || (usesMax !== null && recharge && recharge !== 'turn' && recharge !== 'none')) {
        return {
          kind: 'grantedSpell',
          spell: effect.spell,
          mode: effect.atWill ? 'atWill' : uses ? 'uses' : 'charges',
          chargeCost: String(effect.chargeCost ?? 1),
          usesMax: String(usesMax ?? 1),
          recharge: (recharge as (typeof USE_RECHARGES)[number] | undefined) ?? 'dawn',
        }
      }
    }
    if (effect.type === 'manual') return { kind: 'manual', text: effect.text }
    return { kind: 'raw', effect }
  })
}

/** Form state behind the editor; everything the author can type. */
export type ItemForm = {
  name: string
  description: string
  category: ItemData['category']
  rarity: NonNullable<ItemData['rarity']> | ''
  requiresAttunement: boolean
  weapon: {
    category: 'simple' | 'martial'
    range: 'melee' | 'ranged'
    dice: string
    damageType: string
    versatile: string
    properties: string[]
  }
  armor: {
    category: 'light' | 'medium' | 'heavy' | 'shield'
    baseAc: string
    addDex: boolean
    maxDex: string
  }
  charges: { enabled: boolean; max: string; time: (typeof RECHARGE_TIMES)[number]; formula: string }
  /** Where the weapon stats were copied from, kept with the item (issue #7). */
  basedOn: NonNullable<ItemData['basedOn']> | null
  rows: BuilderRow[]
}

export const EMPTY_FORM: ItemForm = {
  name: '',
  description: '',
  category: 'weapon',
  rarity: 'rare',
  requiresAttunement: false,
  weapon: {
    category: 'martial',
    range: 'melee',
    dice: '1d8',
    damageType: 'slashing',
    versatile: '',
    properties: ['magical'],
  },
  armor: { category: 'light', baseAc: '11', addDex: true, maxDex: '' },
  charges: { enabled: false, max: '3', time: 'dawn', formula: '' },
  basedOn: null,
  rows: [],
}

export function formToDraft(form: ItemForm): ItemDraft {
  const data: ItemData = {
    category: form.category,
    description: form.description,
    magic: true,
    requiresAttunement: form.requiresAttunement,
    ...(form.rarity ? { rarity: form.rarity } : {}),
    ...(form.category === 'weapon'
      ? {
          weapon: {
            category: form.weapon.category,
            range: form.weapon.range,
            damage: {
              dice: form.weapon.dice,
              damageType: form.weapon.damageType as never,
            },
            ...(form.weapon.versatile ? { versatileDamage: form.weapon.versatile } : {}),
            properties: form.weapon.properties as never,
          },
        }
      : {}),
    ...(form.category === 'armor' || form.category === 'shield'
      ? {
          armor: {
            category: form.armor.category,
            baseAc: Number(form.armor.baseAc),
            addDexModifier: form.armor.addDex,
            ...(form.armor.maxDex ? { maxDexBonus: Number(form.armor.maxDex) } : {}),
            stealthDisadvantage: false,
          },
        }
      : {}),
    ...(form.charges.enabled
      ? {
          charges: {
            max: Number(form.charges.max),
            recharge: {
              time: form.charges.time,
              ...(form.charges.formula ? { formula: form.charges.formula } : {}),
            },
          },
        }
      : {}),
    ...(form.basedOn ? { basedOn: form.basedOn } : {}),
  }
  return { name: form.name, data, effects: rowsToEffects(form.rows) }
}

export function draftToForm(name: string, data: ItemData, effects: Effect[]): ItemForm {
  const weapon = data.weapon
  const armor = data.armor
  return {
    name,
    description: data.description,
    category: data.category,
    rarity: data.rarity ?? '',
    requiresAttunement: data.requiresAttunement ?? false,
    weapon: weapon
      ? {
          category: weapon.category,
          range: weapon.range,
          dice: weapon.damage?.dice ?? '1d8',
          damageType: weapon.damage?.damageType ?? 'slashing',
          versatile: weapon.versatileDamage ?? '',
          properties: weapon.properties ?? [],
        }
      : EMPTY_FORM.weapon,
    armor: armor
      ? {
          category: armor.category,
          baseAc: String(armor.baseAc),
          addDex: armor.addDexModifier,
          maxDex: armor.maxDexBonus !== undefined ? String(armor.maxDexBonus) : '',
        }
      : EMPTY_FORM.armor,
    charges: data.charges
      ? {
          enabled: true,
          max: typeof data.charges.max === 'number' ? String(data.charges.max) : '1',
          time: data.charges.recharge.time,
          formula: data.charges.recharge.formula ?? '',
        }
      : EMPTY_FORM.charges,
    basedOn: data.basedOn ?? null,
    rows: effectsToRows(effects),
  }
}
