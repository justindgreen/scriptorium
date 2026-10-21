/**
 * Converts the upstream 5e-bits SRD 5.1 dataset into Scriptorium content packages.
 * Mechanics (effects, choices, automation, tests) come from overlay files in
 * content/srd-5.1/mechanics/*.json keyed by uid; everything the converter emits for class,
 * subclass, species and item features without an overlay is marked `automation: pending`.
 */
import {
  makeUid,
  parseContentPackage,
  type ContentEntry,
  type ContentKind,
  type ContentPackage,
  type PackageIssue,
} from '@scriptorium/content-schema'
import { readUpstream } from './download.js'

export const SOURCE_SLUG = 'srd-5.1'
export const RULESET_ID = 'srd5.1-2014'

export const SRD_ATTRIBUTION =
  'This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode. Structured data was converted from the 5e-bits/5e-database project (MIT licensed code).'

export const SOURCE = {
  slug: SOURCE_SLUG,
  name: 'System Reference Document 5.1',
  kind: 'srd' as const,
  license: 'CC-BY-4.0',
  attributionText: SRD_ATTRIBUTION,
  version: '5.1.0',
  publisher: 'Wizards of the Coast LLC',
  url: 'https://dnd.wizards.com/resources/systems-reference-document',
  description:
    'The 2014 rules foundation: classes, species, backgrounds, spells, equipment, magic items, monsters, conditions and core rules.',
}

type Ref = { index: string; name?: string }
type AnyRecord = Record<string, unknown>

export type Overlay = Partial<
  Pick<ContentEntry, 'effects' | 'choices' | 'automation' | 'tests' | 'tags'>
> & { uid: string }

const uid = (kind: ContentKind, slug: string) => makeUid(SOURCE_SLUG, kind, slug)
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const md = (lines: unknown): string =>
  Array.isArray(lines) ? lines.map(String).join('\n\n') : typeof lines === 'string' ? lines : ''

const pending = { level: 'pending' as const }

function castingTimeType(
  text: string,
): 'action' | 'bonus' | 'reaction' | 'minute' | 'hour' | 'special' {
  const t = text.toLowerCase()
  if (t.includes('bonus')) return 'bonus'
  if (t.includes('reaction')) return 'reaction'
  if (t.includes('action')) return 'action'
  if (t.includes('minute')) return 'minute'
  if (t.includes('hour')) return 'hour'
  return 'special'
}

const SCHOOLS = new Set([
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
])

export function convertSpells(dir: string): ContentEntry[] {
  const spells = readUpstream<AnyRecord>(dir, 'Spells')
  const entries: ContentEntry[] = []
  const byClass = new Map<string, string[]>()
  for (const s of spells) {
    const slug = slugify(String(s['index']))
    const classes = ((s['classes'] as Ref[] | undefined) ?? []).map((c) =>
      uid('class', slugify(c.index)),
    )
    const subclasses = ((s['subclasses'] as Ref[] | undefined) ?? []).map((c) =>
      uid('subclass', slugify(c.index)),
    )
    const components = (s['components'] as string[] | undefined) ?? []
    const damage = s['damage'] as AnyRecord | undefined
    const dc = s['dc'] as AnyRecord | undefined
    const school = String((s['school'] as Ref).index)
    const spellUid = uid('spell', slug)
    for (const c of classes) byClass.set(c, [...(byClass.get(c) ?? []), spellUid])
    entries.push({
      kind: 'spell',
      uid: spellUid,
      slug,
      name: String(s['name']),
      tags: [
        `level-${String(s['level'])}`,
        school,
        ...(s['ritual'] ? ['ritual'] : []),
        ...(s['concentration'] ? ['concentration'] : []),
      ],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      data: {
        level: Number(s['level']),
        school: (SCHOOLS.has(school) ? school : 'evocation') as 'evocation',
        castingTime: String(s['casting_time']),
        castingTimeType: castingTimeType(String(s['casting_time'])),
        range: String(s['range']),
        components: {
          verbal: components.includes('V'),
          somatic: components.includes('S'),
          material: components.includes('M'),
          ...(s['material'] ? { materialText: String(s['material']) } : {}),
        },
        duration: String(s['duration']),
        concentration: Boolean(s['concentration']),
        ritual: Boolean(s['ritual']),
        description: md(s['desc']),
        ...(Array.isArray(s['higher_level']) && (s['higher_level'] as unknown[]).length > 0
          ? { higherLevels: md(s['higher_level']) }
          : {}),
        classes,
        subclasses,
        ...(s['attack_type'] ? { attackType: String(s['attack_type']) as 'melee' | 'ranged' } : {}),
        ...(dc
          ? {
              save: {
                ability: String((dc['dc_type'] as Ref).index) as 'str',
                onSuccess:
                  dc['dc_success'] === 'half'
                    ? ('half' as const)
                    : dc['dc_success'] === 'none'
                      ? ('none' as const)
                      : ('special' as const),
              },
            }
          : {}),
        ...(damage
          ? {
              damage: {
                ...(damage['damage_type']
                  ? { damageType: String((damage['damage_type'] as Ref).index) as 'fire' }
                  : {}),
                ...(damage['damage_at_slot_level']
                  ? { bySlotLevel: damage['damage_at_slot_level'] as Record<string, string> }
                  : {}),
                ...(damage['damage_at_character_level']
                  ? {
                      byCharacterLevel: damage['damage_at_character_level'] as Record<
                        string,
                        string
                      >,
                    }
                  : {}),
              },
            }
          : {}),
        ...(s['heal_at_slot_level']
          ? { healing: s['heal_at_slot_level'] as Record<string, string> }
          : {}),
        ...(s['area_of_effect']
          ? {
              areaOfEffect: {
                shape: String((s['area_of_effect'] as AnyRecord)['type']) as 'sphere',
                size: Number((s['area_of_effect'] as AnyRecord)['size']),
              },
            }
          : {}),
      },
    })
  }
  for (const [classUid, spellUids] of byClass) {
    const classSlug = classUid.split(':')[2]!
    entries.push({
      kind: 'spell_list',
      uid: uid('spell_list', classSlug),
      slug: classSlug,
      name: `${classSlug.charAt(0).toUpperCase()}${classSlug.slice(1)} spell list`,
      tags: [],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      data: { class: classUid, spells: spellUids.sort() },
    })
  }
  return entries
}

const EQUIPMENT_CATEGORY: Record<string, string> = {
  weapon: 'weapon',
  armor: 'armor',
  'adventuring-gear': 'adventuring-gear',
  tools: 'tool',
  'mounts-and-vehicles': 'mount',
  ammunition: 'ammunition',
  potion: 'potion',
  ring: 'ring',
  rod: 'rod',
  scroll: 'scroll',
  staff: 'staff',
  wand: 'wand',
  'wondrous-items': 'wondrous',
}

const WEAPON_PROPERTY: Record<string, string> = {
  ammunition: 'ammunition',
  finesse: 'finesse',
  heavy: 'heavy',
  light: 'light',
  loading: 'loading',
  reach: 'reach',
  special: 'special',
  thrown: 'thrown',
  'two-handed': 'two-handed',
  versatile: 'versatile',
  monk: 'monk',
}

export function convertEquipment(dir: string): ContentEntry[] {
  const equipment = readUpstream<AnyRecord>(dir, 'Equipment')
  const entries: ContentEntry[] = []
  for (const e of equipment) {
    const slug = slugify(String(e['index']))
    const categoryIndex = String((e['equipment_category'] as Ref).index)
    const armorCat = e['armor_category'] ? String(e['armor_category']).toLowerCase() : null
    const isShield = armorCat === 'shield'
    const category = isShield ? 'shield' : (EQUIPMENT_CATEGORY[categoryIndex] ?? 'other')
    const cost = e['cost'] as { quantity: number; unit: string } | undefined
    const damage = e['damage'] as AnyRecord | undefined
    const twoHanded = e['two_handed_damage'] as AnyRecord | undefined
    const range = e['range'] as { normal?: number; long?: number | null } | undefined
    const throwRange = e['throw_range'] as { normal?: number; long?: number | null } | undefined
    const ac = e['armor_class'] as
      { base: number; dex_bonus: boolean; max_bonus?: number | null } | undefined
    const descLines = [
      ...((e['desc'] as string[] | undefined) ?? []),
      ...((e['special'] as string[] | undefined) ?? []),
    ]
    const weapon =
      categoryIndex === 'weapon'
        ? {
            category: (String(e['weapon_category']).toLowerCase() === 'martial'
              ? 'martial'
              : 'simple') as 'simple',
            range: (String(e['weapon_range']).toLowerCase() === 'ranged'
              ? 'ranged'
              : 'melee') as 'melee',
            ...(damage &&
            typeof damage['damage_dice'] === 'string' &&
            /^\d+d\d+$/.test(String(damage['damage_dice']))
              ? {
                  damage: {
                    dice: String(damage['damage_dice']),
                    damageType: String((damage['damage_type'] as Ref).index) as 'slashing',
                  },
                }
              : {}),
            ...(twoHanded && /^\d+d\d+$/.test(String(twoHanded['damage_dice']))
              ? { versatileDamage: String(twoHanded['damage_dice']) }
              : {}),
            properties: ((e['properties'] as Ref[] | undefined) ?? [])
              .map((p) => WEAPON_PROPERTY[p.index])
              .filter((p): p is string => Boolean(p)) as 'finesse'[],
            ...(range?.normal && String(e['weapon_range']).toLowerCase() === 'ranged'
              ? { normalRange: range.normal, ...(range.long ? { longRange: range.long } : {}) }
              : {}),
            ...(throwRange?.normal
              ? {
                  throwNormalRange: throwRange.normal,
                  ...(throwRange.long ? { throwLongRange: throwRange.long } : {}),
                }
              : {}),
          }
        : undefined
    const armor =
      armorCat && ac && !isShield
        ? {
            category: armorCat as 'light',
            baseAc: Number(ac.base),
            addDexModifier: Boolean(ac.dex_bonus),
            ...(ac.max_bonus ? { maxDexBonus: Number(ac.max_bonus) } : {}),
            ...(e['str_minimum'] ? { strengthMinimum: Number(e['str_minimum']) } : {}),
            stealthDisadvantage: Boolean(e['stealth_disadvantage']),
          }
        : undefined
    const subcategory =
      (e['gear_category'] as Ref | undefined)?.name ??
      (e['tool_category'] as string | undefined) ??
      (e['vehicle_category'] as string | undefined) ??
      (e['category_range'] as string | undefined)
    entries.push({
      kind: 'item',
      uid: uid('item', slug),
      slug,
      name: String(e['name']),
      tags: [
        category,
        ...(weapon ? [weapon.category, weapon.range] : []),
        ...(armor ? [armor.category] : []),
      ],
      effects:
        isShield && ac
          ? [{ type: 'bonus' as const, target: 'ac.bonus', value: Number(ac.base), note: 'Shield' }]
          : [],
      choices: [],
      tests: [],
      relations: [],
      ...(weapon || armor || isShield
        ? {
            automation: {
              level: 'full' as const,
              notes: isShield
                ? 'Shield bonus applies while equipped.'
                : 'Structured weapon/armor data is read directly by the rules engine.',
            },
          }
        : {}),
      data: {
        category: category as 'weapon',
        ...(subcategory ? { subcategory: String(subcategory) } : {}),
        description: descLines.join('\n\n') || `${String(e['name'])}.`,
        ...(cost ? { cost: { quantity: Number(cost.quantity), unit: cost.unit as 'gp' } } : {}),
        ...(typeof e['weight'] === 'number' ? { weight: Number(e['weight']) } : {}),
        magic: false,
        requiresAttunement: false,
        ...(weapon ? { weapon } : {}),
        ...(armor ? { armor } : {}),
        ...(typeof e['quantity'] === 'number'
          ? { quantityPerPurchase: Number(e['quantity']) }
          : {}),
      },
    })
  }
  return entries
}

export function convertMagicItems(dir: string): ContentEntry[] {
  const items = readUpstream<AnyRecord>(dir, 'Magic-Items')
  const entries: ContentEntry[] = []
  for (const m of items) {
    const slug = slugify(String(m['index']))
    const desc = (m['desc'] as string[] | undefined) ?? []
    const header = desc[0] ?? ''
    const categoryIndex = String((m['equipment_category'] as Ref).index)
    const rarityName = String((m['rarity'] as { name?: string } | undefined)?.name ?? 'varies')
      .toLowerCase()
      .replace(/\s+/g, '-')
    const rarity = [
      'common',
      'uncommon',
      'rare',
      'very-rare',
      'legendary',
      'artifact',
      'varies',
    ].includes(rarityName)
      ? rarityName
      : 'varies'
    const attune = /requires attunement/i.test(header)
    const prereq = header.match(/requires attunement by ([^)]+)\)/i)?.[1]
    const category = EQUIPMENT_CATEGORY[categoryIndex] ?? 'wondrous'
    const variantOf =
      (m['variant'] as boolean) && Array.isArray(m['variants']) ? undefined : undefined
    entries.push({
      kind: 'item',
      uid: uid('item', slug),
      slug,
      name: String(m['name']),
      tags: ['magic', category, rarity, ...(attune ? ['attunement'] : [])],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: {
        category: category as 'wondrous',
        description: desc.join('\n\n'),
        magic: true,
        rarity: rarity as 'rare',
        requiresAttunement: attune,
        ...(prereq ? { attunementPrerequisite: prereq.trim() } : {}),
        ...(variantOf ? { variantOf } : {}),
      },
    })
  }
  return entries
}

const SIZES = new Set(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'])
const CREATURE_TYPES = new Set([
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
  'swarm',
])
const SKILL_IDS = new Set([
  'acrobatics',
  'animal-handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight-of-hand',
  'stealth',
  'survival',
])

function feet(value: unknown): number | boolean | null {
  if (typeof value === 'boolean') return value
  const m = String(value ?? '').match(/(\d+)/)
  return m ? Number(m[1]) : null
}

function monsterAction(a: AnyRecord) {
  const damage = ((a['damage'] as AnyRecord[] | undefined) ?? [])
    .filter((d) => typeof d['damage_dice'] === 'string')
    .map((d) => ({
      dice: String(d['damage_dice']),
      ...(d['damage_type']
        ? { damageType: String((d['damage_type'] as Ref).index) as 'slashing' }
        : {}),
    }))
  const desc = String(a['desc'] ?? '')
  const attackMatch = desc.match(
    /^(Melee|Ranged|Melee or Ranged) (Weapon|Spell) Attack:\s*([+-]\d+) to hit(?:, reach (\d+) ft\.)?(?:,? range (\d+)(?:\/(\d+))? ft\.)?/i,
  )
  const attack =
    typeof a['attack_bonus'] === 'number' || attackMatch
      ? {
          kind: (attackMatch
            ? `${attackMatch[1]!.toLowerCase().startsWith('melee or') ? 'melee-or-ranged' : attackMatch[1]!.toLowerCase()}${attackMatch[2]!.toLowerCase() === 'spell' ? (attackMatch[1]!.toLowerCase() === 'ranged' ? '' : '') : ''}`
            : 'melee') as 'melee',
          toHit:
            typeof a['attack_bonus'] === 'number'
              ? Number(a['attack_bonus'])
              : Number(attackMatch?.[3] ?? 0),
          ...(attackMatch?.[4] ? { reach: Number(attackMatch[4]) } : {}),
          ...(attackMatch?.[5]
            ? {
                range: {
                  normal: Number(attackMatch[5]),
                  ...(attackMatch[6] ? { long: Number(attackMatch[6]) } : {}),
                },
              }
            : {}),
        }
      : undefined
  if (attack && attackMatch && attackMatch[2]!.toLowerCase() === 'spell') {
    attack.kind = (
      attackMatch[1]!.toLowerCase() === 'ranged' ? 'spell-ranged' : 'spell-melee'
    ) as 'melee'
  }
  const dc = a['dc'] as AnyRecord | undefined
  const usage = a['usage'] as AnyRecord | undefined
  return {
    name: String(a['name']),
    description: desc,
    ...(attack ? { attack } : {}),
    damage,
    ...(dc
      ? {
          save: {
            ability: String((dc['dc_type'] as Ref).index) as 'str',
            dc: Number(dc['dc_value']),
            onSuccess:
              dc['success_type'] === 'half'
                ? ('half' as const)
                : dc['success_type'] === 'none'
                  ? ('none' as const)
                  : ('special' as const),
          },
        }
      : {}),
    ...(usage?.['type'] === 'recharge on roll'
      ? { recharge: `${String(usage['min_value'] ?? 6)}-6` }
      : {}),
    ...(usage?.['type'] === 'per day' ? { usage: `${String(usage['times'] ?? 1)}/day` } : {}),
  }
}

export function convertMonsters(dir: string): ContentEntry[] {
  const monsters = readUpstream<AnyRecord>(dir, 'Monsters')
  const entries: ContentEntry[] = []
  for (const m of monsters) {
    const slug = slugify(String(m['index']))
    const size = String(m['size']).toLowerCase()
    const type = String(m['type']).toLowerCase()
    const acRaw = m['armor_class']
    const armorClass = Array.isArray(acRaw)
      ? (acRaw as AnyRecord[]).map((ac) => ({
          value: Number(ac['value']),
          ...(ac['type'] ? { source: String(ac['type']) } : {}),
        }))
      : [{ value: Number(acRaw) }]
    const speedRaw = (m['speed'] as AnyRecord | undefined) ?? {}
    const speed: Record<string, number | boolean> = {}
    for (const [mode, value] of Object.entries(speedRaw)) {
      const parsed = feet(value)
      if (parsed !== null && ['walk', 'fly', 'swim', 'climb', 'burrow', 'hover'].includes(mode))
        speed[mode] = parsed
    }
    const savingThrows: Record<string, number> = {}
    const skills: Record<string, number> = {}
    for (const p of (m['proficiencies'] as AnyRecord[] | undefined) ?? []) {
      const index = String((p['proficiency'] as Ref).index)
      if (index.startsWith('saving-throw-'))
        savingThrows[index.replace('saving-throw-', '')] = Number(p['value'])
      else if (index.startsWith('skill-')) {
        const skill = index.replace('skill-', '')
        if (SKILL_IDS.has(skill)) skills[skill] = Number(p['value'])
      }
    }
    const senses: Record<string, number | string> = {}
    for (const [k, v] of Object.entries((m['senses'] as AnyRecord | undefined) ?? {})) {
      const n = feet(v)
      senses[k.replace(/_/g, ' ')] = typeof n === 'number' ? n : String(v)
    }
    const legendary = (m['legendary_actions'] as AnyRecord[] | undefined) ?? []
    entries.push({
      kind: 'monster',
      uid: uid('monster', slug),
      slug,
      name: String(m['name']),
      tags: [type, size, `cr-${String(m['challenge_rating'])}`],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      data: {
        size: (SIZES.has(size) ? size : 'medium') as 'medium',
        type: (CREATURE_TYPES.has(type)
          ? type
          : type.startsWith('swarm')
            ? 'swarm'
            : 'monstrosity') as 'undead',
        ...(m['subtype'] ? { subtype: String(m['subtype']) } : {}),
        alignment: String(m['alignment'] ?? 'unaligned'),
        armorClass,
        hitPoints: {
          average: Number(m['hit_points']),
          formula: String(m['hit_points_roll'] ?? m['hit_dice'] ?? ''),
        },
        speed,
        abilities: {
          str: Number(m['strength']),
          dex: Number(m['dexterity']),
          con: Number(m['constitution']),
          int: Number(m['intelligence']),
          wis: Number(m['wisdom']),
          cha: Number(m['charisma']),
        },
        savingThrows,
        skills,
        damageVulnerabilities: ((m['damage_vulnerabilities'] as string[] | undefined) ?? []).map(
          String,
        ),
        damageResistances: ((m['damage_resistances'] as string[] | undefined) ?? []).map(String),
        damageImmunities: ((m['damage_immunities'] as string[] | undefined) ?? []).map(String),
        conditionImmunities: ((m['condition_immunities'] as Ref[] | undefined) ?? []).map((c) =>
          slugify(c.index),
        ),
        senses,
        languages: String(m['languages'] ?? ''),
        challengeRating: Number(m['challenge_rating']),
        xp: Number(m['xp'] ?? 0),
        proficiencyBonus: Number(m['proficiency_bonus'] ?? 2),
        traits: ((m['special_abilities'] as AnyRecord[] | undefined) ?? []).map((t) => ({
          name: String(t['name']),
          description: String(t['desc'] ?? ''),
        })),
        actions: ((m['actions'] as AnyRecord[] | undefined) ?? []).map(monsterAction),
        bonusActions: [],
        reactions: ((m['reactions'] as AnyRecord[] | undefined) ?? []).map(monsterAction),
        ...(legendary.length > 0
          ? { legendaryActions: { count: 3, actions: legendary.map(monsterAction) } }
          : {}),
        ...(m['desc'] ? { description: String(m['desc']) } : {}),
        ...(m['image'] ? { image: String(m['image']) } : {}),
      },
    })
  }
  return entries
}

export function convertRules(dir: string): ContentEntry[] {
  const entries: ContentEntry[] = []
  for (const c of readUpstream<AnyRecord>(dir, 'Conditions')) {
    const slug = slugify(String(c['index']))
    entries.push({
      kind: 'condition',
      uid: uid('condition', slug),
      slug,
      name: String(c['name']),
      tags: [],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: { description: md(c['desc']) },
    })
  }
  const rules = readUpstream<AnyRecord>(dir, 'Rules')
  const sectionParent = new Map<string, string>()
  rules.forEach((r, order) => {
    const slug = slugify(String(r['index']))
    for (const s of (r['subsections'] as Ref[] | undefined) ?? [])
      sectionParent.set(s.index, uid('rule', slug))
    entries.push({
      kind: 'rule',
      uid: uid('rule', slug),
      slug,
      name: String(r['name']),
      tags: ['chapter'],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      data: { category: String(r['name']), description: String(r['desc'] ?? ''), order },
    })
  })
  readUpstream<AnyRecord>(dir, 'Rule-Sections').forEach((s, order) => {
    const slug = slugify(String(s['index']))
    const parent = sectionParent.get(String(s['index']))
    entries.push({
      kind: 'rule',
      uid: uid('rule', slug),
      slug,
      name: String(s['name']),
      tags: ['section'],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      data: {
        category: parent ? parent.split(':')[2]! : 'general',
        description: String(s['desc'] ?? ''),
        ...(parent ? { parent } : {}),
        order,
      },
    })
  })
  return entries
}

type ProficiencyRef = { index: string; name: string }

function proficiencyTarget(p: ProficiencyRef): string {
  return p.index
}

const PRIMARY_ABILITIES: Record<string, string[]> = {
  barbarian: ['str'],
  bard: ['cha'],
  cleric: ['wis'],
  druid: ['wis'],
  fighter: ['str', 'dex'],
  monk: ['dex', 'wis'],
  paladin: ['str', 'cha'],
  ranger: ['dex', 'wis'],
  rogue: ['dex'],
  sorcerer: ['cha'],
  warlock: ['cha'],
  wizard: ['int'],
}

export function convertClasses(dir: string): ContentEntry[] {
  const classes = readUpstream<AnyRecord>(dir, 'Classes')
  const subclasses = readUpstream<AnyRecord>(dir, 'Subclasses')
  const levels = readUpstream<AnyRecord>(dir, 'Levels')
  const features = readUpstream<AnyRecord>(dir, 'Features')
  const entries: ContentEntry[] = []
  const featureSlugs = new Set<string>()

  for (const f of features) {
    const slug = slugify(String(f['index']))
    if (featureSlugs.has(slug)) continue
    featureSlugs.add(slug)
    const cls = f['class'] as Ref | undefined
    const sub = f['subclass'] as Ref | undefined
    const owner = sub
      ? uid('subclass', slugify(sub.index))
      : cls
        ? uid('class', slugify(cls.index))
        : undefined
    entries.push({
      kind: 'feature',
      uid: uid('feature', slug),
      slug,
      name: String(f['name']),
      tags: [...(cls ? [slugify(cls.index)] : []), ...(sub ? [slugify(sub.index)] : [])],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: {
        description: md(f['desc']),
        ...(typeof f['level'] === 'number' ? { level: Number(f['level']) } : {}),
        ...(owner ? { owner } : {}),
      },
    })
  }

  for (const c of classes) {
    const slug = slugify(String(c['index']))
    const classUid = uid('class', slug)
    const classLevels = levels.filter(
      (l) => (l['class'] as Ref).index === c['index'] && !l['subclass'],
    )
    const profs = ((c['proficiencies'] as ProficiencyRef[] | undefined) ?? []).map(
      proficiencyTarget,
    )
    const skillChoice = ((c['proficiency_choices'] as AnyRecord[] | undefined) ?? []).find(
      (pc) =>
        String(pc['desc'] ?? '')
          .toLowerCase()
          .startsWith('choose') && JSON.stringify(pc).includes('skill-'),
    )
    const skillOptions = (
      ((skillChoice?.['from'] as AnyRecord | undefined)?.['options'] as AnyRecord[] | undefined) ??
      []
    )
      .map((o) => String((o['item'] as Ref | undefined)?.index ?? '').replace('skill-', ''))
      .filter((s) => SKILL_IDS.has(s))
    const toolChoice = ((c['proficiency_choices'] as AnyRecord[] | undefined) ?? []).find(
      (pc) => pc !== skillChoice,
    )
    const toolOptions = (
      ((toolChoice?.['from'] as AnyRecord | undefined)?.['options'] as AnyRecord[] | undefined) ??
      []
    )
      .map((o) => String((o['item'] as Ref | undefined)?.index ?? ''))
      .filter(Boolean)
    const spellcasting = c['spellcasting'] as AnyRecord | undefined
    const progression = ['bard', 'cleric', 'druid', 'sorcerer', 'wizard'].includes(slug)
      ? 'full'
      : ['paladin', 'ranger'].includes(slug)
        ? 'half'
        : slug === 'warlock'
          ? 'pact'
          : null
    const preparation = ['cleric', 'druid', 'paladin'].includes(slug)
      ? 'prepared'
      : slug === 'wizard'
        ? 'spellbook'
        : 'known'
    const mc = c['multi_classing'] as AnyRecord | undefined
    const mcPrereqs = ((mc?.['prerequisites'] as AnyRecord[] | undefined) ?? []).map((p) => ({
      leaf: 'abilityScore' as const,
      ability: String((p['ability_score'] as Ref).index) as 'str',
      gte: Number(p['minimum_score']),
    }))
    const mcPrereqOptions = mc?.['prerequisite_options'] as AnyRecord | undefined
    const mcAnyPrereqs = (
      ((mcPrereqOptions?.['from'] as AnyRecord | undefined)?.['options'] as
        AnyRecord[] | undefined) ?? []
    ).map((o) => ({
      leaf: 'abilityScore' as const,
      ability: String((o['ability_score'] as Ref).index) as 'str',
      gte: Number(o['minimum_score']),
    }))
    const prerequisite =
      mcPrereqs.length > 0
        ? mcPrereqs.length === 1
          ? mcPrereqs[0]
          : { all: mcPrereqs }
        : mcAnyPrereqs.length > 0
          ? { any: mcAnyPrereqs }
          : undefined
    entries.push({
      kind: 'class',
      uid: classUid,
      slug,
      name: String(c['name']),
      tags: [progression ? 'caster' : 'martial'],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: {
        description: `${String(c['name'])}.`,
        hitDie: `d${String(c['hit_die'])}` as 'd10',
        primaryAbilities: (PRIMARY_ABILITIES[slug] ?? ['str']) as 'str'[],
        savingThrows: ((c['saving_throws'] as Ref[]) ?? []).map((s) => s.index as 'str') as [
          'str',
          'con',
        ],
        proficiencies: {
          armor: profs.filter((p) => /armor|shield/.test(p)),
          weapons: profs.filter(
            (p) =>
              /weapon|sword|bow|dagger|dart|sling|quarterstaff|crossbow|club|mace|rapier|scimitar|flail|glaive|halberd|lance|maul|pike|trident|whip|handaxe|javelin|spear|sickle|net|blowgun/.test(
                p,
              ) && !/armor|shield/.test(p),
          ),
          tools: profs.filter(
            (p) =>
              !/armor|shield|weapon|saving-throw|skill-|sword|bow|dagger|dart|sling|quarterstaff|crossbow|club|mace|rapier|scimitar|flail|glaive|halberd|lance|maul|pike|trident|whip|handaxe|javelin|spear|sickle|net|blowgun/.test(
                p,
              ),
          ),
          ...(toolOptions.length > 0
            ? { toolChoice: { count: Number(toolChoice?.['choose'] ?? 1), from: toolOptions } }
            : {}),
          skills: {
            count: Number(skillChoice?.['choose'] ?? 2),
            from: skillOptions.length > 0 ? skillOptions : [...SKILL_IDS],
          },
        },
        startingEquipment: ((c['starting_equipment'] as AnyRecord[] | undefined) ?? []).map(
          (se) => ({
            item: uid('item', slugify(String((se['equipment'] as Ref).index))),
            quantity: Number(se['quantity'] ?? 1),
          }),
        ),
        startingEquipmentOptions: (
          (c['starting_equipment_options'] as AnyRecord[] | undefined) ?? []
        ).map((o) => ({
          description: String(o['desc'] ?? 'Choose one'),
          choose: Number(o['choose'] ?? 1),
          options: (
            ((o['from'] as AnyRecord | undefined)?.['options'] as AnyRecord[] | undefined) ?? []
          ).map((opt) => equipmentOption(opt)),
        })),
        levels: classLevels
          .sort((a, b) => Number(a['level']) - Number(b['level']))
          .map((l) => {
            const sc = l['spellcasting'] as AnyRecord | undefined
            const slots = sc
              ? Array.from({ length: 9 }, (_, i) => Number(sc[`spell_slots_level_${i + 1}`] ?? 0))
              : undefined
            return {
              level: Number(l['level']),
              proficiencyBonus: Number(l['prof_bonus']),
              features: ((l['features'] as Ref[] | undefined) ?? []).map((f) =>
                uid('feature', slugify(f.index)),
              ),
              columns: Object.fromEntries(
                Object.entries((l['class_specific'] as AnyRecord | undefined) ?? {})
                  .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
                  .map(([k, v]) => [k.replace(/_/g, '-'), v as number | string]),
              ),
              ...(slots && slots.some((n) => n > 0) ? { spellSlots: slots } : {}),
              ...(sc && typeof sc['cantrips_known'] === 'number'
                ? { cantripsKnown: Number(sc['cantrips_known']) }
                : {}),
              ...(sc && typeof sc['spells_known'] === 'number'
                ? { spellsKnown: Number(sc['spells_known']) }
                : {}),
            }
          }),
        subclassLevel: Math.min(
          ...levels
            .filter((l) => (l['class'] as Ref).index === c['index'] && l['subclass'])
            .map((l) => Number(l['level'])),
          3,
        ),
        subclassTitle: String(
          (
            subclasses.find((s) => (s['class'] as Ref).index === c['index']) as
              AnyRecord | undefined
          )?.['subclass_flavor'] ?? 'Subclass',
        ),
        ...(spellcasting && progression
          ? {
              spellcasting: {
                ability: String((spellcasting['spellcasting_ability'] as Ref).index) as 'int',
                progression: progression as 'full',
                preparation: preparation as 'known',
                list: uid('spell_list', slug),
                startsAtLevel: Number(spellcasting['level'] ?? 1),
              },
            }
          : {}),
        ...(mc
          ? {
              multiclassing: {
                ...(prerequisite ? { prerequisite } : {}),
                proficiencies: {
                  armor: ((mc['proficiencies'] as ProficiencyRef[] | undefined) ?? [])
                    .map(proficiencyTarget)
                    .filter((p) => /armor|shield/.test(p)),
                  weapons: ((mc['proficiencies'] as ProficiencyRef[] | undefined) ?? [])
                    .map(proficiencyTarget)
                    .filter((p) => /weapon/.test(p)),
                  tools: [],
                },
              },
            }
          : {}),
      },
    })
  }

  for (const s of subclasses) {
    const slug = slugify(String(s['index']))
    const classSlug = slugify(String((s['class'] as Ref).index))
    const subLevels = levels.filter((l) => (l['subclass'] as Ref | undefined)?.index === s['index'])
    const spellsByLevel = new Map<number, string[]>()
    for (const sp of (s['spells'] as AnyRecord[] | undefined) ?? []) {
      const prereq = ((sp['prerequisites'] as AnyRecord[] | undefined) ?? [])[0]
      const level = Number(String(prereq?.['index'] ?? '').match(/-(\d+)$/)?.[1] ?? 1)
      spellsByLevel.set(level, [
        ...(spellsByLevel.get(level) ?? []),
        uid('spell', slugify(String((sp['spell'] as Ref).index))),
      ])
    }
    entries.push({
      kind: 'subclass',
      uid: uid('subclass', slug),
      slug,
      name: String(s['name']),
      tags: [classSlug],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: {
        description: md(s['desc']),
        class: uid('class', classSlug),
        ...(s['subclass_flavor'] ? { flavor: String(s['subclass_flavor']) } : {}),
        levels: subLevels
          .sort((a, b) => Number(a['level']) - Number(b['level']))
          .map((l) => ({
            level: Number(l['level']),
            features: ((l['features'] as Ref[] | undefined) ?? []).map((f) =>
              uid('feature', slugify(f.index)),
            ),
          })),
        spells: [...spellsByLevel.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([level, spells]) => ({ level, spells })),
      },
    })
  }
  return entries
}

function equipmentOption(opt: AnyRecord): {
  description: string
  items: Array<{ item: string; quantity: number }>
} {
  const type = String(opt['option_type'])
  if (type === 'counted_reference') {
    const of = opt['of'] as Ref
    return {
      description: `${String(opt['count'] ?? 1)} × ${of.name ?? of.index}`,
      items: [{ item: uid('item', slugify(of.index)), quantity: Number(opt['count'] ?? 1) }],
    }
  }
  if (type === 'multiple') {
    const parts = ((opt['items'] as AnyRecord[] | undefined) ?? []).map(equipmentOption)
    return {
      description: parts.map((p) => p.description).join(', '),
      items: parts.flatMap((p) => p.items),
    }
  }
  if (type === 'choice') {
    const choice = opt['choice'] as AnyRecord
    return { description: String(choice['desc'] ?? 'a choice of equipment'), items: [] }
  }
  return { description: String(opt['desc'] ?? 'equipment'), items: [] }
}

export function convertSpecies(dir: string): ContentEntry[] {
  const races = readUpstream<AnyRecord>(dir, 'Races')
  const subraces = readUpstream<AnyRecord>(dir, 'Subraces')
  const traits = readUpstream<AnyRecord>(dir, 'Traits')
  const entries: ContentEntry[] = []
  const traitName = new Map(traits.map((t) => [String(t['index']), String(t['name'])]))
  for (const t of traits) {
    const slug = slugify(String(t['index']))
    const owners = [
      ...((t['races'] as Ref[] | undefined) ?? []).map((r) => slugify(r.index)),
      ...((t['subraces'] as Ref[] | undefined) ?? []).map((r) => slugify(r.index)),
    ]
    entries.push({
      kind: 'feature',
      uid: uid('feature', slug),
      slug,
      name: String(t['name']),
      tags: ['trait', ...owners],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: {
        description: md(t['desc']),
        ...(owners[0] ? { owner: uid('species', owners[0]) } : {}),
      },
    })
  }
  const toTraitRefs = (refs: Ref[] | undefined) =>
    (refs ?? []).map((r) => ({
      uid: uid('feature', slugify(r.index)),
      name: traitName.get(r.index) ?? r.name ?? r.index,
    }))
  for (const r of races) {
    const slug = slugify(String(r['index']))
    entries.push({
      kind: 'species',
      uid: uid('species', slug),
      slug,
      name: String(r['name']),
      tags: [],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: {
        description: `${String(r['name'])}.`,
        size: String(r['size'] ?? 'Medium').toLowerCase() as 'medium',
        ...(r['size_description'] ? { sizeDescription: String(r['size_description']) } : {}),
        speed: Number(r['speed'] ?? 30),
        ...(r['age'] ? { age: String(r['age']) } : {}),
        ...(r['alignment'] ? { alignment: String(r['alignment']) } : {}),
        ...(r['language_desc'] ? { languageDescription: String(r['language_desc']) } : {}),
        traits: toTraitRefs(r['traits'] as Ref[] | undefined),
      },
    })
  }
  for (const s of subraces) {
    const slug = slugify(String(s['index']))
    entries.push({
      kind: 'species',
      uid: uid('species', slug),
      slug,
      name: String(s['name']),
      tags: ['subrace'],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: {
        description: md(s['desc']),
        parent: uid('species', slugify(String((s['race'] as Ref).index))),
        traits: toTraitRefs(s['racial_traits'] as Ref[] | undefined),
      },
    })
  }
  return entries
}

export function convertBackgroundsAndFeats(dir: string): ContentEntry[] {
  const entries: ContentEntry[] = []
  for (const b of readUpstream<AnyRecord>(dir, 'Backgrounds')) {
    const slug = slugify(String(b['index']))
    const profs = ((b['starting_proficiencies'] as Ref[] | undefined) ?? []).map((p) => p.index)
    const strings = (key: string) =>
      (
        (((b[key] as AnyRecord | undefined)?.['from'] as AnyRecord | undefined)?.['options'] as
          AnyRecord[] | undefined) ?? []
      )
        .map((o) => String(o['string'] ?? o['desc'] ?? ''))
        .filter(Boolean)
    const feature = b['feature'] as AnyRecord
    entries.push({
      kind: 'background',
      uid: uid('background', slug),
      slug,
      name: String(b['name']),
      tags: [],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: {
        description: `${String(b['name'])}.`,
        skillProficiencies: profs
          .filter((p) => p.startsWith('skill-'))
          .map((p) => p.replace('skill-', ''))
          .filter((p) => SKILL_IDS.has(p)) as 'insight'[],
        toolProficiencies: profs.filter((p) => !p.startsWith('skill-')),
        languages: Number((b['language_options'] as AnyRecord | undefined)?.['choose'] ?? 0),
        equipment: ((b['starting_equipment'] as AnyRecord[] | undefined) ?? []).map((se) => ({
          item: uid('item', slugify(String((se['equipment'] as Ref).index))),
          quantity: Number(se['quantity'] ?? 1),
        })),
        feature: { name: String(feature['name']), description: md(feature['desc']) },
        characteristics: {
          personalityTraits: strings('personality_traits'),
          ideals: strings('ideals'),
          bonds: strings('bonds'),
          flaws: strings('flaws'),
        },
      },
    })
  }
  for (const f of readUpstream<AnyRecord>(dir, 'Feats')) {
    const slug = slugify(String(f['index']))
    const prereqs = ((f['prerequisites'] as AnyRecord[] | undefined) ?? []).map((p) => ({
      leaf: 'abilityScore' as const,
      ability: String((p['ability_score'] as Ref).index) as 'str',
      gte: Number(p['minimum_score']),
    }))
    entries.push({
      kind: 'feat',
      uid: uid('feat', slug),
      slug,
      name: String(f['name']),
      tags: [],
      effects: [],
      choices: [],
      tests: [],
      relations: [],
      automation: pending,
      data: {
        description: md(f['desc']),
        ...(prereqs.length > 0
          ? { prerequisite: prereqs.length === 1 ? prereqs[0]! : { all: prereqs } }
          : {}),
      },
    })
  }
  return entries
}

/** Applies mechanics overlays (by uid) onto converted entries. */
export function applyOverlays(
  entries: ContentEntry[],
  overlays: Overlay[],
): { entries: ContentEntry[]; unmatched: string[] } {
  const byUid = new Map(overlays.map((o) => [o.uid, o]))
  const matched = new Set<string>()
  const out = entries.map((entry) => {
    const o = byUid.get(entry.uid)
    if (!o) return entry
    matched.add(entry.uid)
    return {
      ...entry,
      ...(o.effects ? { effects: o.effects } : {}),
      ...(o.choices ? { choices: o.choices } : {}),
      ...(o.automation ? { automation: o.automation } : {}),
      ...(o.tests ? { tests: o.tests } : {}),
      ...(o.tags ? { tags: [...new Set([...entry.tags, ...o.tags])] } : {}),
    } as ContentEntry
  })
  return { entries: out, unmatched: overlays.map((o) => o.uid).filter((u) => !matched.has(u)) }
}

export type PackageGroup = { name: string; entries: ContentEntry[] }

export function buildPackages(
  dir: string,
  overlays: Overlay[] = [],
): {
  packages: Array<{ name: string; package: ContentPackage }>
  issues: Array<{ name: string; issues: PackageIssue[] }>
  unmatchedOverlays: string[]
} {
  const groups: PackageGroup[] = [
    { name: 'spells', entries: convertSpells(dir) },
    { name: 'equipment', entries: [...convertEquipment(dir), ...convertMagicItems(dir)] },
    { name: 'monsters', entries: convertMonsters(dir) },
    { name: 'rules', entries: convertRules(dir) },
    { name: 'classes', entries: convertClasses(dir) },
    { name: 'species', entries: convertSpecies(dir) },
    { name: 'backgrounds-feats', entries: convertBackgroundsAndFeats(dir) },
  ]
  const packages: Array<{ name: string; package: ContentPackage }> = []
  const issues: Array<{ name: string; issues: PackageIssue[] }> = []
  const matchedOverlays = new Set<string>()
  for (const group of groups) {
    const applied = applyOverlays(group.entries, overlays)
    for (const o of overlays) if (!applied.unmatched.includes(o.uid)) matchedOverlays.add(o.uid)
    const candidate = {
      format: 'scriptorium-content-package',
      formatVersion: 1,
      source: SOURCE,
      rulesetId: RULESET_ID,
      entries: applied.entries,
    }
    const parsed = parseContentPackage(candidate)
    if (parsed.ok) packages.push({ name: group.name, package: parsed.package })
    else issues.push({ name: group.name, issues: parsed.issues })
  }
  return {
    packages,
    issues,
    unmatchedOverlays: overlays.map((o) => o.uid).filter((u) => !matchedOverlays.has(u)),
  }
}
