import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const port = 3100
const baseURL = `http://localhost:${port}`

/**
 * End-to-end tests run against the production-style server serving the built web app on a
 * fresh embedded database, so every run starts at the setup wizard.
 */
const e2eDataDir = path.join(rootDir, '.data', 'e2e')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env['CI'] ? 2 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // First-run flow (wizard, invite, registration) runs alone and first; it owns the fresh database.
    {
      name: 'first-run',
      testMatch: /auth.spec.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'desktop',
      dependencies: ['first-run'],
      testIgnore: /auth.spec.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'tablet',
      dependencies: ['first-run'],
      testIgnore: /auth.spec.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'phone',
      dependencies: ['first-run'],
      testIgnore: /auth.spec.ts/,
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: 'pnpm build && node e2e/start-server.mjs',
    url: `${baseURL}/readyz`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    env: {
      NODE_ENV: 'test',
      PORT: String(port),
      LOG_LEVEL: 'warn',
      DATA_DIR: e2eDataDir,
      DEV_PG_PORT: '54331',
      APP_SECRET: 'e2e-secret-'.padEnd(48, 'x'),
      PUBLIC_URL: baseURL,
      // The server starts with its package directory as cwd, so the path must be absolute.
      WEB_DIST_DIR: path.join(rootDir, 'apps', 'web', 'dist'),
      ...(process.env['DATABASE_URL'] ? { DATABASE_URL: process.env['DATABASE_URL'] } : {}),
    },
  },
})
