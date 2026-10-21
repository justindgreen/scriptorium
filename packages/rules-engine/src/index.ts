/**
 * @scriptorium/rules-engine
 *
 * Pure TypeScript. No I/O, no clock, no randomness. Runs on the server (source of truth) and in the
 * browser (previews). May import only @scriptorium/content-schema and @scriptorium/dice/ast;
 * eslint.config.js enforces this. The engine itself lands in M2.2 (static) and M2.3 (actions).
 */
import { packageName as diceAst } from '@scriptorium/dice/ast'
import { CONTENT_SCHEMA_VERSION } from '@scriptorium/content-schema'

export const ENGINE_VERSION = '0.0.1' as const

/** The content schema version this engine build understands. */
export const SUPPORTED_CONTENT_SCHEMA_VERSION = CONTENT_SCHEMA_VERSION

export const allowedDependencies = [diceAst, '@scriptorium/content-schema'] as const
