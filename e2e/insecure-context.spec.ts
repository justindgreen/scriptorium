import { expect, test, type Locator } from '@playwright/test'
import { admin, buildCharacter, ensureSetup, signInAs } from './helpers'

/**
 * GitHub issue #2: on a plain-HTTP LAN address the browser has no `crypto.randomUUID` and no
 * Clipboard API. Playwright runs on localhost, which browsers treat as secure, so this spec
 * removes both before any page script runs and then exercises the paths that broke: choices,
 * subclass, equipment, damage, reload, and the invite link copy fallback.
 */
test.beforeEach(async ({ page, request }) => {
  await ensureSetup(request)
  await page.addInitScript(() => {
    // What an insecure context looks like: secure randomness stays, randomUUID and clipboard go.
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  })
})

async function press(locator: Locator) {
  await expect(locator).toBeEnabled()
  await locator.focus()
  await locator.press('Enter')
}

test('character commands and the invite link work without randomUUID or the Clipboard API', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await signInAs(page, admin.username, admin.password)
  const name = `Lan ${testInfo.project.name} ${Date.now().toString(36)}`
  await buildCharacter(page, name, {
    label: 'Cleric',
    species: 'Hill Dwarf',
    background: 'Acolyte',
  })
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined')

  const skills = page.getByTestId('choice-class:srd-5.1:class:cleric@1/skills')
  await skills.getByTestId('option-medicine').check()
  await skills.getByTestId('option-religion').check()
  await press(skills.getByTestId('save-class:srd-5.1:class:cleric@1/skills'))
  await expect(skills).toBeHidden()
  await expect(page.getByText(/revision 1$/)).toBeVisible()

  await page.getByTestId('subclass-select').selectOption({ label: 'Life' })
  await press(page.getByTestId('subclass-set'))
  await expect(page.getByText(/\(Life\)/)).toBeVisible()

  await page.getByTestId('item-search').fill('mace')
  await press(page.getByTestId('add-srd-5.1:item:mace'))
  await expect(page.getByTestId('action-templates')).toContainText('Mace')
  await page.getByLabel('Amount').first().fill('4')
  await press(page.getByTestId('damage'))
  await expect(page.getByTestId('stat-hp')).toContainText('7 / 11')
  await expect(page.getByText(/revision 4$/)).toBeVisible()

  await page.reload()
  await expect(page.getByText(/revision 4$/)).toBeVisible()
  await expect(page.getByText(/\(Life\)/)).toBeVisible()
  await expect(page.getByTestId('stat-hp')).toContainText('7 / 11')
  await expect(page.getByTestId('action-templates')).toContainText('Mace')
  await expect(page.getByTestId('skills')).toContainText('Medicine ●')

  // The invite link: no clipboard, so the link is selected for a manual copy.
  await page.goto('/campaigns')
  await page.getByTestId('campaign-name').fill(`Lan ${Date.now().toString(36)}`)
  await press(page.getByTestId('campaign-create'))
  await press(page.getByTestId('invite-create'))
  await expect(page.getByTestId('invite-url')).toContainText('/campaigns/join?code=')
  await press(page.getByTestId('invite-copy'))
  await expect(page.getByTestId('invite-copy-note')).toContainText('press Ctrl+C')
  const selected = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="invite-url-input"]') as HTMLInputElement
    return (
      input.selectionEnd! - input.selectionStart! === input.value.length && input.value.length > 0
    )
  })
  expect(selected).toBe(true)
  expect(errors.filter((m) => /randomUUID|clipboard/i.test(m))).toEqual([])
})
