/**
 * Public surface of the server package for other workspace packages.
 * The web app may import TYPES from here only (enforced by eslint.config.js).
 */
export { buildApp } from './app.js'
export type { App } from './app.js'
export { loadConfig, ConfigError } from './core/config.js'
export type { Config } from './core/config.js'

/** Placeholder for the tRPC router type exported once the API exists (M1.3). */
export type AppRouter = never
