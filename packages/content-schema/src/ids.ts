import { z } from 'zod'

export const CONTENT_KINDS = [
  'class',
  'subclass',
  'species',
  'background',
  'feat',
  'feature',
  'spell',
  'spell_list',
  'item',
  'monster',
  'condition',
  'rule',
  'resource',
] as const
export type ContentKind = (typeof CONTENT_KINDS)[number]
export const contentKindSchema = z.enum(CONTENT_KINDS)

/** URL-safe identifier segment: lowercase letters, digits and dashes. */
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase letters, digits and dashes')

/** Source collection slug may also contain dots (e.g. `srd-5.1`). */
export const sourceSlugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(
    /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/,
    'source slug must be lowercase letters, digits, dashes and dots',
  )

/** Stable content identity: `<source>:<kind>:<slug>`, e.g. `srd-5.1:spell:fireball`. */
export const uidSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:[-.][a-z0-9]+)*:(class|subclass|species|background|feat|feature|spell|spell_list|item|monster|condition|rule|resource):[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'uid must look like <source>:<kind>:<slug>',
  )

export type Uid = z.infer<typeof uidSchema>

export function makeUid(source: string, kind: ContentKind, slug: string): string {
  return `${source}:${kind}:${slug}`
}

export function parseUid(uid: string): { source: string; kind: ContentKind; slug: string } {
  const parsed = uidSchema.parse(uid)
  const [source, kind, slug] = parsed.split(':') as [string, ContentKind, string]
  return { source, kind, slug }
}

export const rulesetIdSchema = z.string().regex(/^[a-z0-9]+(?:[-.][a-z0-9]+)*$/)

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type Ability = (typeof ABILITIES)[number]
export const abilitySchema = z.enum(ABILITIES)

export const SKILLS = [
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
] as const
export type Skill = (typeof SKILLS)[number]
export const skillSchema = z.enum(SKILLS)

export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const
export type DamageType = (typeof DAMAGE_TYPES)[number]
export const damageTypeSchema = z.enum(DAMAGE_TYPES)

export const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const
export const sizeSchema = z.enum(SIZES)

export const CREATURE_TYPES = [
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
] as const
export const creatureTypeSchema = z.enum(CREATURE_TYPES)

export const WEAPON_PROPERTIES = [
  'ammunition',
  'finesse',
  'heavy',
  'light',
  'loading',
  'reach',
  'special',
  'thrown',
  'two-handed',
  'versatile',
  'monk',
  'silvered',
  'adamantine',
  'magical',
] as const
export const weaponPropertySchema = z.enum(WEAPON_PROPERTIES)

export const ARMOR_CATEGORIES = ['light', 'medium', 'heavy', 'shield'] as const
export const armorCategorySchema = z.enum(ARMOR_CATEGORIES)

export const SPEED_MODES = ['walk', 'fly', 'swim', 'climb', 'burrow'] as const
export const speedModeSchema = z.enum(SPEED_MODES)

export const SENSES = ['darkvision', 'blindsight', 'tremorsense', 'truesight'] as const
export const senseSchema = z.enum(SENSES)

/** Markdown text as stored; rendered through a strict sanitizer in the UI. */
export const markdownSchema = z.string().max(200_000)
