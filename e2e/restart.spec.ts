import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { admin, buildCharacter, ensureSetup, signInAs } from './helpers'

/**
 * M2.6: sheet state survives a server restart. The supervisor in `e2e/start-server.mjs` restarts
 * the server when `restart.request` appears in the data directory; this project runs alone and
 * after the others, because requests fail while the server is down.
 */
const dataDir = path.resolve(process.cwd(), '.data', 'e2e')

async function uptime(request: APIRequestContext): Promise<number> {
  try {
    const response = await request.get('/healthz', { timeout: 2_000 })
    if (!response.ok()) return -1
    return ((await response.json()) as { uptimeSeconds: number }).uptimeSeconds
  } catch {
    return -1
  }
}

async function restartServer(request: APIRequestContext): Promise<void> {
  const before = await uptime(request)
  expect(before).toBeGreaterThanOrEqual(0)
  // With an external database (CI) nothing has created the data directory yet.
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'restart.request'), String(Date.now()))
  // Wait until a new process answers: its uptime is lower than the old one's.
  await expect
    .poll(async () => uptime(request), { timeout: 120_000, intervals: [1_000] })
    .toBeLessThan(Math.max(1, before))
  await expect
    .poll(async () => (await request.get('/readyz').catch(() => null))?.status() ?? 0, {
      timeout: 60_000,
      intervals: [500],
    })
    .toBe(200)
}

test('sheet changes survive a server restart and the live stream reconnects', async ({
  page,
  request,
}) => {
  test.setTimeout(300_000)
  await ensureSetup(request)
  await signInAs(page, admin.username, admin.password)
  await buildCharacter(page, `Restart ${Date.now().toString(36)}`, {
    label: 'Fighter',
    species: 'Human',
    background: 'Acolyte',
  })
  await page.getByLabel('Amount').first().fill('4')
  await page.getByTestId('damage').click()
  await expect(page.getByTestId('stat-hp')).toContainText('8 / 12')
  await page.getByTestId('coin-add-gp').click()
  await expect(page.getByTestId('coin-gp')).toHaveText('1')
  await expect(page.getByText(/revision 2$/)).toBeVisible()
  await expect(page.getByTestId('live-status')).toHaveText('Live')

  await restartServer(request)

  // The open page falls back to polling while the server is down and reconnects afterwards.
  await expect(page.getByTestId('live-status')).toHaveText('Live', { timeout: 90_000 })
  await page.reload()
  await expect(page.getByText(/revision 2$/)).toBeVisible()
  await expect(page.getByTestId('stat-hp')).toContainText('8 / 12')
  await expect(page.getByTestId('coin-gp')).toHaveText('1')
  await expect(page.getByTestId('event-log').locator('li')).toHaveCount(2)

  // The session survived too: another command works against the restarted server.
  await page.getByTestId('heal').click()
  await expect(page.getByTestId('stat-hp')).toContainText('12 / 12')
  await expect(page.getByText(/revision 3$/)).toBeVisible()
})
