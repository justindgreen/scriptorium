import { z } from 'zod'
import { statPathSchema } from './statPaths.js'

/**
 * Automation honesty (docs/RULES_ENGINE.md §9, TEST_STRATEGY.md §3).
 * - full: every mechanical part is produced by effects.
 * - partial: some parts automated; manualParts lists what is not.
 * - manual: descriptive only.
 * - pending: mechanics not authored yet (imported skeletons). Counts as unverified in coverage.
 */
export const automationLevelSchema = z.enum(['full', 'partial', 'manual', 'pending'])

export const automationSchema = z
  .strictObject({
    level: automationLevelSchema,
    manualParts: z.array(z.string().min(1).max(200)).optional(),
    notes: z.string().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.level === 'partial' && (!value.manualParts || value.manualParts.length === 0)) {
      ctx.addIssue({ code: 'custom', message: 'partial automation must list manualParts' })
    }
  })

export type Automation = z.infer<typeof automationSchema>

/** Behavioural case executed by the conformance runner through the real engine. */
export const behaviouralCaseSchema = z.strictObject({
  name: z.string().min(1).max(120).optional(),
  given: z.strictObject({
    /** Name of a fixture aggregate shipped with the content package or engine tests. */
    fixture: z.string().min(1).max(120),
    /** A patch deep-merged into the fixture before evaluation (objects merge, arrays replace). */
    modify: z.record(z.string(), z.unknown()).optional(),
  }),
  expect: z.union([
    z.strictObject({
      stat: statPathSchema,
      equals: z.union([z.number(), z.string(), z.boolean()]).optional(),
      atLeast: z.number().optional(),
      contains: z.union([z.string(), z.number()]).optional(),
    }),
    z.strictObject({
      actionPlan: z.strictObject({
        ref: z.record(z.string(), z.unknown()),
        ctx: z.record(z.string(), z.unknown()).default({}),
      }),
      contains: z.record(z.string(), z.unknown()).optional(),
      excludes: z.record(z.string(), z.unknown()).optional(),
    }),
    z.strictObject({
      command: z.record(z.string(), z.unknown()),
      expectState: z.record(z.string(), z.unknown()).optional(),
      expectError: z.string().optional(),
    }),
    /** A proficiency set contains an id (armor, weapons, tools, languages). */
    z.strictObject({
      proficient: z.strictObject({
        set: z.enum(['armor', 'weapons', 'tools', 'languages']),
        id: z.string().min(1),
      }),
    }),
    /** The sheet lists the spell as known, prepared or granted. */
    z.strictObject({ knownSpell: z.string().min(1) }),
    /** The sheet lists a defense (conditional ones included). */
    z.strictObject({
      defense: z.strictObject({
        kind: z.enum(['resistance', 'immunity', 'vulnerability']),
        damageType: z.string().min(1),
      }),
    }),
  ]),
})

export type BehaviouralCase = z.infer<typeof behaviouralCaseSchema>
