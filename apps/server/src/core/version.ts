/** Application version, injected at build time from the root package.json when available. */
export const APP_VERSION: string = process.env['APP_VERSION'] ?? '0.0.1-dev'
