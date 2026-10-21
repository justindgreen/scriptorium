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
