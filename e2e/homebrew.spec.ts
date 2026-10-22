import { expect, test, type Locator, type Page } from '@playwright/test'
import { admin, buildCharacter, ensureSetup, expectAccessible, signInAs } from './helpers'

/**
 * M2.7: the specification's sword (+3 to hit and damage, 1d8 radiant against fiends and undead,
 * three charges of a granted spell, attunement) is authored through the form, previewed on a
 * character, published, given to that character, and its mechanics show on the sheet and in an
 * action plan.
 */
test.beforeEach(async ({ request }) => {
  await ensureSetup(request)
})

async function press(locator: Locator) {
  await expect(locator).toBeEnabled()
  await locator.focus()
  await locator.press('Enter')
}

async function ensureSource(page: Page, name: string) {
  await page.goto('/homebrew')
  const sources = page.getByTestId('sources')
  await expect(sources).toBeVisible()
  if (await sources.getByText('No source yet.').isVisible()) {
    await page.getByTestId('source-name').fill(name)
    await press(page.getByTestId('source-create'))
    await expect(sources.getByText(name)).toBeVisible()
  }
}

test('the sword example is authored, previewed, published and lands on a sheet', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000)
  await signInAs(page, admin.username, admin.password)
  const stamp = Date.now().toString(36)
  const heroName = `Forge ${testInfo.project.name} ${stamp}`
  await buildCharacter(page, heroName, {
    label: 'Fighter',
    species: 'Human',
    background: 'Acolyte',
  })

  await ensureSource(page, `Forge ${stamp}`)
  await press(page.getByTestId('new-item'))
  await expect(page).toHaveURL(/\/homebrew\/items\/new$/)

  const itemName = `Fiendbane ${testInfo.project.name} ${stamp}`
  await page.getByTestId('item-name').fill(itemName)
  await page.getByTestId('item-description').fill('A +3 longsword that burns fiends and undead.')
  await page.getByTestId('base-weapon-search').fill('longsword')
  await press(page.getByTestId('base-srd-5.1:item:longsword'))
  await expect(page.getByTestId('weapon-dice')).toHaveValue('1d8')
  await page.getByTestId('item-attunement').check()
  await page.getByTestId('item-charges').check()
  await page.getByTestId('charges-max').fill('3')

  await press(page.getByTestId('add-bonus'))
  await page.getByTestId('effect-0-target').selectOption('attack.weapon.self')
  await page.getByTestId('effect-0-value').fill('3')
  await press(page.getByTestId('add-bonus'))
  await page.getByTestId('effect-1-target').selectOption('damage.weapon.self')
  await page.getByTestId('effect-1-value').fill('3')
  await press(page.getByTestId('add-extraDamage'))
  await page.getByTestId('effect-2-formula').fill('1d8')
  await page.getByTestId('effect-2-damage-type').selectOption('radiant')
  await page.getByTestId('effect-2-type-fiend').check()
  await page.getByTestId('effect-2-type-undead').check()
  await press(page.getByTestId('add-grantedSpell'))
  await page.getByTestId('effect-3-spell-search').fill('bless')
  await press(page.getByTestId('pick-srd-5.1:spell:bless'))
  await expect(page.getByTestId('effect-3-spell')).toHaveText('Bless')

  await expect(page.getByTestId('validation-status')).toHaveText('valid')
  await expect(page.getByTestId('automation-level')).toHaveText('automation: full')
  if (testInfo.project.name === 'desktop') await expectAccessible(page)

  await press(page.getByTestId('item-save'))
  await expect(page).toHaveURL(/\/homebrew\/items\/[0-9a-f-]{36}$/)
  await expect(page.getByText(/Draft v1, never published/)).toBeVisible()

  // Preview on the fighter: STR 16 (+3) + proficiency 2 + 3 = +8; the rider needs a fiend.
  await page.getByTestId('preview-character').selectOption({ label: heroName })
  await page.getByTestId('preview-target').selectOption('fiend')
  const preview = page.getByTestId('preview-result')
  await expect(preview).toContainText(`${itemName} +8, 1d8 + 6 slashing`)
  await expect(page.getByTestId('preview-plan')).toContainText('1d8 + 6 slashing + 1d8 radiant')
  await expect(preview).toContainText('Grants Bless (1 charge)')
  await expect(page.getByTestId('give-item')).toBeDisabled()

  await press(page.getByTestId('item-publish'))
  await expect(page.getByText(/Published v1/)).toBeVisible()
  await press(page.getByTestId('give-item'))
  await press(page.getByTestId('open-character'))
  await expect(page).toHaveURL(/\/characters\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: heroName })).toBeVisible()

  // On the sheet: the item is carried, charged, and attuning switches its bonuses on.
  const inventory = page.getByTestId('inventory')
  await expect(inventory).toContainText(itemName)
  await expect(inventory).toContainText('3/3 charges')
  await expect(page.getByTestId('action-templates')).toContainText(`${itemName} +5`)
  await press(inventory.getByRole('button', { name: 'Attune' }).first())
  await expect(page.getByTestId('action-templates')).toContainText(`${itemName} +8`)
  await expect(page.getByTestId('granted-spells')).toContainText('Bless')

  const toggle = page
    .getByTestId(/^action-.*-toggle$/)
    .filter({ hasText: itemName })
    .first()
  await press(toggle)
  const card = toggle.locator('..')
  await expect(card).toContainText('Attack +8')
  await card.getByText('Situation and target').click()
  await card.getByLabel('Target type').selectOption('fiend')
  await expect(card).toContainText('1d8 radiant')
})
