/**
 * @scriptorium/content-schema
 *
 * Zod schemas shared by the server, the web app and the rules engine: content kinds, effects
 * (static and action scoped), predicates, choices, stat paths, automation metadata, the portable
 * package format and the ruleset configuration. Structural validation lives here; semantic checks
 * that need a character (cycles, scope at evaluation time) live in the rules engine.
 */
export const schemaPackageName = '@scriptorium/content-schema' as const

/** Version of the content JSON shape. Bumped only with a migrator for stored content_versions. */
export const CONTENT_SCHEMA_VERSION = 1 as const

export * from './ids.js'
export * from './statPaths.js'
export * from './formula.js'
export * from './predicates.js'
export * from './effects.js'
export * from './choices.js'
export * from './automation.js'
export * from './kinds.js'
export * from './entry.js'
export * from './package.js'
export * from './ruleset.js'
