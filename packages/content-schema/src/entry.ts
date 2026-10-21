import { z } from 'zod'
import { automationSchema, behaviouralCaseSchema } from './automation.js'
import { choiceSchema } from './choices.js'
import { effectSchema } from './effects.js'
import {
  contentKindSchema,
  rulesetIdSchema,
  slugSchema,
  uidSchema,
  type ContentKind,
} from './ids.js'
import { KIND_DATA_SCHEMAS } from './kinds.js'

export const RELATION_KINDS = [
  'grants',
  'requires',
  'subclass_of',
  'list_member',
  'variant_of',
  'parent_of',
  'owner_of',
] as const
export const relationSchema = z.strictObject({ to: uidSchema, relation: z.enum(RELATION_KINDS) })

const entryCommon = {
  uid: uidSchema,
  slug: slugSchema,
  name: z.string().min(1).max(160),
  /** Overrides the package ruleset for this entry; usually omitted. */
  rulesetId: rulesetIdSchema.optional(),
  effects: z.array(effectSchema).default([]),
  choices: z.array(choiceSchema).default([]),
  automation: automationSchema.optional(),
  tests: z.array(behaviouralCaseSchema).default([]),
  tags: z.array(z.string().min(1).max(40)).default([]),
  relations: z.array(relationSchema).default([]),
  /** Where this entry's text comes from inside the source (page, section). */
  reference: z.string().max(120).optional(),
}

function entryFor<K extends ContentKind>(kind: K) {
  return z
    .strictObject({ kind: z.literal(kind), data: KIND_DATA_SCHEMAS[kind], ...entryCommon })
    .superRefine((entry, ctx) => {
      const [source, uidKind, slug] = entry.uid.split(':')
      if (uidKind !== entry.kind)
        ctx.addIssue({
          code: 'custom',
          path: ['uid'],
          message: `uid kind "${uidKind}" does not match entry kind "${entry.kind}"`,
        })
      if (slug !== entry.slug)
        ctx.addIssue({
          code: 'custom',
          path: ['uid'],
          message: `uid slug "${slug}" does not match entry slug "${entry.slug}"`,
        })
      if (!source)
        ctx.addIssue({ code: 'custom', path: ['uid'], message: 'uid is missing its source' })
      // Mechanics claim honesty: automation 'full' or 'partial' needs at least one mechanical effect or choice.
      const data = (
        entry as unknown as { data: { weapon?: unknown; armor?: unknown; charges?: unknown } }
      ).data
      const structural =
        entry.kind === 'item' && (data.weapon || data.armor || data.charges) ? 1 : 0
      const mechanical =
        entry.effects.filter((e) => e.type !== 'manual').length + entry.choices.length + structural
      if (
        entry.automation &&
        (entry.automation.level === 'full' || entry.automation.level === 'partial') &&
        mechanical === 0
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['automation'],
          message: `automation "${entry.automation.level}" requires mechanical effects or choices`,
        })
      }
      if (entry.automation?.level === 'full' && entry.effects.some((e) => e.type === 'manual')) {
        ctx.addIssue({
          code: 'custom',
          path: ['automation'],
          message: 'automation "full" cannot include manual effects',
        })
      }
    })
}

export const contentEntrySchema = z.discriminatedUnion('kind', [
  entryFor('class'),
  entryFor('subclass'),
  entryFor('species'),
  entryFor('background'),
  entryFor('feat'),
  entryFor('feature'),
  entryFor('spell'),
  entryFor('spell_list'),
  entryFor('item'),
  entryFor('monster'),
  entryFor('condition'),
  entryFor('rule'),
  entryFor('resource'),
])

export type ContentEntry = z.infer<typeof contentEntrySchema>
export type ContentEntryOf<K extends ContentKind> = Extract<ContentEntry, { kind: K }>

export { contentKindSchema }
