import fs from 'node:fs'
import path from 'node:path'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

export const admin = {
  username: 'gamemaster',
  displayName: 'Game Master',
  password: 'correct-horse-battery',
}

/**
 * Makes sure the instance has its administrator and returns nothing. Safe to call from several
 * spec files at once: the loser of the race gets 409 and moves on.
 */
export async function ensureSetup(request: APIRequestContext): Promise<void> {
  const status = await request.get('/api/trpc/system.status')
  const body = (await status.json()) as { result: { data: { setupComplete: boolean } } }
  if (body.result.data.setupComplete) return
  const res = await request.post('/api/trpc/setup.createAdmin', {
    data: { instanceName: 'Thursday Table', ...admin },
  })
  expect([200, 409]).toContain(res.status())
}

export async function signInAs(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
}

/** Fails the test on any serious or critical accessibility violation on the current page. */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )
  expect(
    serious,
    JSON.stringify(
      serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
      null,
      2,
    ),
  ).toEqual([])
}

export type AlphaClass = { label: string; species: string; background: string; subclass?: string }

/** Creates a level-1 character through the builder and lands on its sheet. */
export async function buildCharacter(page: Page, name: string, cls: AlphaClass): Promise<void> {
  await page.goto('/characters/new')
  await page.getByTestId('builder-name').fill(name)
  await page.getByTestId('builder-class').selectOption({ label: cls.label })
  await page.getByTestId('builder-species').selectOption({ label: cls.species })
  // An empty background leaves "Choose later" selected: the sheet completes it (issue #21).
  if (cls.background)
    await page.getByTestId('builder-background').selectOption({ label: cls.background })
  await page.getByTestId('builder-create').click()
  await expect(page).toHaveURL(/\/characters\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { name })).toBeVisible()
}

/**
 * Restarts the E2E server through the supervisor in `e2e/start-server.mjs` (it watches for
 * `restart.request` in the data directory) and waits until a new process answers.
 */
const dataDir = path.resolve(process.cwd(), '.data', 'e2e')

export async function uptime(request: APIRequestContext): Promise<number> {
  try {
    const response = await request.get('/healthz', { timeout: 2_000 })
    if (!response.ok()) return -1
    return ((await response.json()) as { uptimeSeconds: number }).uptimeSeconds
  } catch {
    return -1
  }
}

export async function restartServer(request: APIRequestContext): Promise<void> {
  const before = await uptime(request)
  expect(before).toBeGreaterThanOrEqual(0)
  // With an external database (CI) nothing has created the data directory yet.
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'restart.request'), String(Date.now()))
  // Wait until a new process answers: its uptime is lower than the old one's (-1 while down).
  await expect
    .poll(
      async () => {
        const now = await uptime(request)
        return now >= 0 && now < Math.max(1, before)
      },
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBe(true)
  await expect
    .poll(async () => (await request.get('/readyz').catch(() => null))?.status() ?? 0, {
      timeout: 60_000,
      intervals: [500],
    })
    .toBe(200)
}
