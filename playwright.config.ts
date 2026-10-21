import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const port = 3100
const baseURL = `http://localhost:${port}`

/**
 * End-to-end tests run against the production-style server serving the built web app,
 * so they exercise the same static hosting and SPA fallback as a deployment.
 */
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm build && pnpm --filter @scriptorium/server start',
    url: `${baseURL}/healthz`,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(port),
      LOG_LEVEL: 'warn',
      // The server starts with its package directory as cwd, so the path must be absolute.
      WEB_DIST_DIR: path.join(rootDir, 'apps', 'web', 'dist'),
    },
  },
})
