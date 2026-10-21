/**
 * Public surface of the server package for other workspace packages.
 * The web app may import TYPES from here only (enforced by eslint.config.js).
 */
export { buildApp } from './app.js'
export type { App, AppDeps } from './app.js'
export { loadConfig, ConfigError } from './core/config.js'
export type { Config } from './core/config.js'
export type { AppRouter } from './router.js'
