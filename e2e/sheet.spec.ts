import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  admin,
  buildCharacter,
  ensureSetup,
  expectAccessible,
  expectNoSidewaysOverflow,
  signInAs,
} from './helpers'

/**
 * M2.6: every interactive sheet control issues a command and the result survives a reload. The
 * same spec runs on the desktop, tablet and phone projects; `restart.spec.ts` covers a server
 * restart.
 */
test.beforeEach(async ({ request }) => {
  await ensureSetup(request)
})

async function press(locator: Locator) {
  // Keyboard activation is layout-independent (the sticky header can cover a pointer click on
  // the phone viewport after an automatic scroll).
  await expect(locator).toBeEnabled()
  await locator.focus()
  await locator.press('Enter')
}

async function waitForRevision(page: Page, revision: number) {
  await expect(page.getByText(new RegExp(`revision ${revision}$`))).toBeVisible()
}

test('sheet controls persist through a reload', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await signInAs(page, admin.username, admin.password)
  const name = `Sheet ${testInfo.project.name} ${Date.now().toString(36)}`
  await buildCharacter(page, name, {
    label: 'Fighter',
    species: 'Human',
    background: 'Acolyte',
  })
  let revision = 0

  // Equipment feeds the action list.
  await page.getByTestId('item-search').fill('longsword')
  await press(page.getByTestId('add-srd-5.1:item:longsword'))
  await waitForRevision(page, ++revision)
  await expect(page.getByTestId('action-templates')).toContainText('Longsword')

  // Temporary hit points.
  await page.getByLabel('Amount').first().fill('3')
  await press(page.getByTestId('temp-hp'))
  await waitForRevision(page, ++revision)
  await expect(page.getByTestId('stat-hp')).toContainText('(+3 temp)')

  // Resources: Second Wind is a short-rest resource at level 1.
  await expect(page.getByTestId('resource-second-wind')).toHaveText('1/1')
  await press(page.getByTestId('use-second-wind'))
  await waitForRevision(page, ++revision)
  await expect(page.getByTestId('resource-second-wind')).toHaveText('0/1')

  // Coins.
  await page.getByTestId('coin-amount').fill('7')
  await press(page.getByTestId('coin-add-gp'))
  await waitForRevision(page, ++revision)
  await expect(page.getByTestId('coin-gp')).toHaveText('7')

  // Conditions and exhaustion.
  await page.getByTestId('condition-select').selectOption({ label: 'Prone' })
  await press(page.getByTestId('condition-add'))
  await waitForRevision(page, ++revision)
  await expect(page.getByTestId('active-conditions')).toContainText('Prone')
  await page.getByTestId('exhaustion').selectOption('1')
  await waitForRevision(page, ++revision)
  await expect(page.getByTestId('exhaustion')).toHaveValue('1')

  // Inspiration.
  await press(page.getByTestId('inspiration'))
  await waitForRevision(page, ++revision)
  await expect(page.getByTestId('inspiration')).toHaveText('Inspired')

  // A manual override keeps the engine value visible.
  await page.getByTestId('override-path').selectOption('ac.total')
  await page.getByTestId('override-value').fill('20')
  await press(page.getByTestId('override-set'))
  await waitForRevision(page, ++revision)
  await expect(page.getByTestId('stat-ac')).toHaveText('20')
  await expect(page.getByTestId('override-list')).toContainText('engine: ')

  // An attack: plan, roll on the server, apply the outcome.
  const toggle = page
    .getByTestId(/^action-.*-toggle$/)
    .filter({ hasText: 'Longsword' })
    .first()
  await press(toggle)
  const card = toggle.locator('..')
  await expect(card).toContainText('Attack +5')
  await press(card.getByTestId(/^action-.*-roll$/))
  await expect(card.getByTestId('roll-result')).toContainText('Attack roll')
  await press(card.getByTestId(/^action-.*-apply$/))
  await waitForRevision(page, ++revision)
  await expect(card.getByTestId('applied-result')).toContainText(/Longsword (hit|missed|rolled)/)
  await expect(page.getByTestId('event-log').locator('li').first()).toContainText(/Longsword/)

  // A skill check rolls without touching the sheet.
  await page.getByTestId('check-select').selectOption('skill:athletics')
  await press(page.getByTestId('action-check-toggle'))
  await press(page.getByTestId('action-check-roll'))
  await expect(page.getByTestId('action-check').getByTestId('roll-result')).toContainText('Result')
  await waitForRevision(page, revision)

  // Snapshots are taken by hand too.
  await press(page.getByTestId('take-snapshot'))
  await expect(page.getByTestId('history')).toContainText('manual')

  if (testInfo.project.name === 'desktop') await expectAccessible(page)

  await page.reload()
  await waitForRevision(page, revision)
  await expect(page.getByTestId('stat-hp')).toContainText('(+3 temp)')
  await expect(page.getByTestId('resource-second-wind')).toHaveText('0/1')
  await expect(page.getByTestId('coin-gp')).toHaveText('7')
  await expect(page.getByTestId('active-conditions')).toContainText('Prone')
  await expect(page.getByTestId('exhaustion')).toHaveValue('1')
  await expect(page.getByTestId('inspiration')).toHaveText('Inspired')
  await expect(page.getByTestId('stat-ac')).toHaveText('20')
  await expect(page.getByTestId('event-log').locator('li').first()).toContainText(/Longsword/)

  // Live updates are connected on every viewport.
  await expect(page.getByTestId('live-status')).toHaveText('Live')
})

test('a short rest spends hit dice rolled on the server', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await signInAs(page, admin.username, admin.password)
  const name = `Rest ${testInfo.project.name} ${Date.now().toString(36)}`
  await buildCharacter(page, name, { label: 'Fighter', species: 'Human', background: 'Acolyte' })
  await page.getByLabel('Amount').first().fill('9')
  await press(page.getByTestId('damage'))
  await waitForRevision(page, 1)
  await expect(page.getByTestId('stat-hp')).toContainText('3 / 12')

  await press(page.getByTestId('short-rest'))
  await press(page.getByTestId('spend-hit-die-d10'))
  await press(page.getByTestId('roll-hit-die-0'))
  await expect(page.getByTestId('hit-die-roll-0')).not.toHaveValue('')
  await press(page.getByTestId('finish-short-rest'))
  await waitForRevision(page, 2)
  await expect(page.getByTestId('short-rest-form')).toBeHidden()
  // 3 HP + d10 (1–10) + CON modifier (+2 for the standard-array fighter) never stays at 3.
  await expect(page.getByTestId('stat-hp')).not.toContainText('3 / 12')
  await expect(page.getByText(/0\/1 d10/)).toBeVisible()
  await expect(page.getByTestId('event-log').locator('li').first()).toContainText(/Short rest/)
  // Rests are not undoable: the limit is enforced and explained.
  await expect(page.getByTestId('undo')).toBeDisabled()
  await expectNoSidewaysOverflow(page)
  await expect(page.getByTestId('undo-reason')).toContainText(/snapshot/i)
})

test('a long rest asks for confirmation before it restores anything (issue #6)', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  await signInAs(page, admin.username, admin.password)
  await buildCharacter(page, `Rest ${testInfo.project.name} ${Date.now().toString(36)}`, {
    label: 'Fighter',
    species: 'Human',
    background: 'Acolyte',
  })
  await page.getByLabel('Amount').first().fill('4')
  await press(page.getByTestId('damage'))
  await expect(page.getByTestId('stat-hp')).toContainText('8 / 12')
  await press(page.getByTestId('long-rest'))
  await expect(page.getByTestId('long-rest-prompt')).toContainText('Take a long rest?')
  await expect(page.getByTestId('stat-hp')).toContainText('8 / 12')
  await press(page.getByTestId('long-rest-cancel'))
  await expect(page.getByTestId('long-rest-prompt')).toHaveCount(0)
  await expect(page.getByTestId('stat-hp')).toContainText('8 / 12')
  await press(page.getByTestId('long-rest'))
  await press(page.getByTestId('long-rest-confirm'))
  await expect(page.getByTestId('stat-hp')).toContainText('12 / 12')
  await expect(page.getByText(/revision 2$/)).toBeVisible()
})
