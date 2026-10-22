import { expect, test } from '@playwright/test'
import { admin, buildCharacter, ensureSetup, restartServer, signInAs } from './helpers'

/**
 * M2.6: sheet state survives a server restart. The supervisor in `e2e/start-server.mjs` restarts
 * the server when `restart.request` appears in the data directory; this project runs alone and
 * after the others, because requests fail while the server is down.
 */
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
