/**
 * @scriptorium/content-schema
 *
 * Zod schemas shared by the server, the web app and the rules engine.
 * Content kinds, effects, predicates, choices, stat paths and package formats land in M1.5.
 */
export const schemaPackageName = '@scriptorium/content-schema' as const

/** Version of the content JSON shape. Bumped only with a migrator for stored content_versions. */
export const CONTENT_SCHEMA_VERSION = 1 as const
