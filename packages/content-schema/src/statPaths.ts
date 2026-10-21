import { z } from 'zod'

/**
 * Canonical targets for contributions (docs/RULES_ENGINE.md §4). Each entry is a pattern so
 * families such as `skill.<skill>.bonus` and `resource.<id>.max` stay open without listing
 * every member here. `<id>` segments are slugs.
 */
const ABL = '(str|dex|con|int|wis|cha)'
const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*'

export const STAT_PATH_PATTERNS: readonly RegExp[] = [
  new RegExp(`^ability\\.${ABL}\\.(score|mod|max)$`),
  /^proficiencyBonus$/,
  new RegExp(`^save\\.${ABL}\\.(bonus|proficiency)$`),
  new RegExp(`^skill\\.${SLUG}\\.(bonus|proficiency)$`),
  new RegExp(`^check\\.${ABL}$`),
  new RegExp(`^passive\\.${SLUG}$`),
  /^ac\.(base|bonus|total)$/,
  /^initiative\.bonus$/,
  /^speed\.(walk|fly|swim|climb|burrow)$/,
  /^hp\.(max|perLevel)$/,
  /^hitDice\.d(4|6|8|10|12)\.max$/,
  /^attack\.(melee|ranged|spell|unarmed)$/,
  /^attack\.weapon\.self$/,
  /^damage\.(melee|ranged|unarmed)$/,
  /^damage\.weapon\.self$/,
  /^spell\.(saveDC|attack)$/,
  /^spell\.slots\.[1-9]$/,
  /^spell\.pact\.(slots|level)$/,
  /^spell\.(prepared|known)\.max$/,
  /^crit\.range$/,
  /^attacks\.perAction$/,
  new RegExp(`^resource\\.${SLUG}\\.max$`),
  /^sense\.(darkvision|blindsight|tremorsense|truesight)$/,
  /^size$/,
  /^carry\.capacity$/,
  /^defense\.(resistance|immunity|vulnerability)\.(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)$/,
  new RegExp(`^defense\\.conditionImmunity\\.${SLUG}$`),
  new RegExp(`^roll\\.(advantage|disadvantage)\\.${SLUG}(?:\\.${SLUG})*$`),
]

export function isStatPath(value: string): boolean {
  return STAT_PATH_PATTERNS.some((pattern) => pattern.test(value))
}

export const statPathSchema = z.string().superRefine((value, ctx) => {
  if (!isStatPath(value)) ctx.addIssue({ code: 'custom', message: `unknown stat path "${value}"` })
})

export type StatPath = z.infer<typeof statPathSchema>

/**
 * Roll keys used by advantage/disadvantage effects: `save.<abl>`, `save.vs.<tag>`,
 * `check.<skill>`, `check.<abl>`, `attack.<melee|ranged|spell>`, `initiative`, `death-save`,
 * `concentration`.
 */
export const rollKeySchema = z
  .string()
  .regex(
    new RegExp(
      `^(save\\.${ABL}|save\\.vs\\.${SLUG}|check\\.${SLUG}|check\\.${ABL}|attack\\.(melee|ranged|spell)|initiative|death-save|concentration)$`,
    ),
    'unknown roll key',
  )
export type RollKey = z.infer<typeof rollKeySchema>
