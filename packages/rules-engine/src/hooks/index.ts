import type { Effect, StaticEffect } from '@scriptorium/content-schema'
import type { Diagnostic, SourceRef } from '../types.js'

/**
 * Registered hooks (docs/RULES_ENGINE.md §10): the only code-level extension point. A hook
 * expands into ordinary effects so the rest of the engine stays data-driven.
 */
export type HookEffect = Extract<StaticEffect, { type: 'hook' }>

export type HookContext = {
  source: SourceRef
  /** Class the hook was granted through, when known (class features, subclass features). */
  classUid?: string
}

export type HookExpansion = { effects: Effect[] } | { diagnostic: Diagnostic }

type HookImplementation = (params: Record<string, unknown>, context: HookContext) => HookExpansion

const unsupported =
  (hook: string, since: string): HookImplementation =>
  (_params, context) => ({
    diagnostic: {
      code: 'UNSUPPORTED_EFFECT',
      severity: 'warning',
      message: `hook "${hook}" is registered but not implemented before ${since}; "${context.source.name}" is not automated`,
      sources: [context.source],
    },
  })

const registry: Record<string, HookImplementation> = {
  /**
   * Unarmored Movement: `speed.walk` gains the class table column while wearing no armor and no
   * shield. params: { column: string, class?: uid }.
   */
  unarmoredMovement: (params, context) => {
    const column = typeof params.column === 'string' ? params.column : 'unarmored-movement'
    const classUid = typeof params.class === 'string' ? params.class : context.classUid
    if (!classUid) {
      return {
        diagnostic: {
          code: 'UNKNOWN_HOOK',
          severity: 'error',
          message: `hook "unarmoredMovement" needs a class (params.class) when not granted through a class`,
          sources: [context.source],
        },
      }
    }
    return {
      effects: [
        {
          type: 'speed.bonus',
          mode: 'walk',
          value: `table('${column}', classLevel('${classUid}'))`,
          stackKey: 'unarmored-movement',
          note: 'Unarmored Movement',
          condition: {
            all: [
              { leaf: 'armor', category: 'none' },
              { leaf: 'shield', value: false },
            ],
          },
        },
      ],
    }
  },
  scalingDieTable: unsupported('scalingDieTable', 'M2.4'),
  'sorcerer.fontOfMagic': unsupported('sorcerer.fontOfMagic', 'M3.2'),
}

export const REGISTERED_HOOKS = Object.keys(registry)

export function expandHook(effect: HookEffect, context: HookContext): HookExpansion {
  const implementation = registry[effect.hook]
  if (!implementation) {
    return {
      diagnostic: {
        code: 'UNKNOWN_HOOK',
        severity: 'error',
        message: `unknown hook "${effect.hook}" referenced by "${context.source.name}"`,
        sources: [context.source],
      },
    }
  }
  return implementation(effect.params, context)
}
