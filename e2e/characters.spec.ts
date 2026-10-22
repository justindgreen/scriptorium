import { expect, test, type Page } from '@playwright/test'
import { admin, buildCharacter, ensureSetup, expectAccessible, signInAs } from './helpers'

/**
 * M2.5: each alpha class is built at level 1 through the builder and levelled to 5 on the
 * character page; the stale-revision and prerequisite paths are covered by server tests.
 */
test.beforeEach(async ({ request }) => {
  await ensureSetup(request)
})

const ALPHA = [
  { label: 'Fighter', species: 'Human', background: 'Acolyte', subclass: 'Champion' },
  { label: 'Rogue', species: 'High Elf', background: 'Acolyte', subclass: 'Thief' },
  { label: 'Cleric', species: 'Hill Dwarf', background: 'Acolyte', subclass: 'Life' },
  { label: 'Warlock', species: 'Human', background: 'Acolyte', subclass: 'Fiend' },
]

async function setSubclass(page: Page, subclass: string) {
  await page.getByTestId('subclass-select').selectOption({ label: subclass })
  await page.getByTestId('subclass-set').focus()
  await page.getByTestId('subclass-set').press('Enter')
  await expect(page.getByText(new RegExp(`\\(${subclass}\\)`))).toBeVisible()
}

test('builds every alpha class at level 1 and levels it to 5', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  await signInAs(page, admin.username, admin.password)
  for (const cls of ALPHA) {
    const name = `${cls.label} ${testInfo.project.name} ${Date.now().toString(36)}`
    await buildCharacter(page, name, cls)
    await expect(page.getByText(/Level 1 ·/)).toBeVisible()
    await expect(page.getByTestId('pending-choices')).toBeVisible()
    if (cls.label === 'Fighter') await expectAccessible(page)

    let revision = 0
    for (let level = 2; level <= 5; level += 1) {
      // Wait until the previous command's refetch has landed so the next one carries the right revision.
      await expect(page.getByText(new RegExp(`revision ${revision}$`))).toBeVisible()
      await page.getByTestId('levelup-class').selectOption({ label: cls.label })
      const add = page.getByTestId('levelup-add')
      // Keyboard activation: on the phone viewport a pointer click can land on the sticky header
      // after the automatic scroll; Enter on the focused button is layout-independent.
      await expect(add).toBeEnabled()
      await add.focus()
      await add.press('Enter')
      await expect(page.getByText(new RegExp(`Level ${level} ·`))).toBeVisible()
      revision += 1
      if (level === 3 && cls.label !== 'Cleric' && cls.label !== 'Warlock') {
        await setSubclass(page, cls.subclass)
        revision += 1
      }
    }
    if (cls.label === 'Cleric' || cls.label === 'Warlock') await setSubclass(page, cls.subclass)
    await expect(page.getByTestId('event-log').locator('li').first()).toBeVisible()
  }
  await page.goto('/characters')
  await expect(page.getByTestId('character-list').locator('li').first()).toBeVisible()
})

test('choices, equipment and undo survive a reload', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await signInAs(page, admin.username, admin.password)
  const name = `Undo ${testInfo.project.name} ${Date.now().toString(36)}`
  await buildCharacter(page, name, ALPHA[0]!)

  const skills = page.getByTestId('choice-class:srd-5.1:class:fighter@1/skills')
  await skills.getByTestId('option-athletics').check()
  await skills.getByTestId('option-perception').check()
  await skills.getByTestId('save-class:srd-5.1:class:fighter@1/skills').click()
  await expect(skills).toBeHidden()

  await page.getByTestId('item-search').fill('longsword')
  await page.getByTestId('add-srd-5.1:item:longsword').click()
  await expect(page.getByTestId('action-templates')).toContainText('Longsword')
  await expect(page.getByText(/revision 2$/)).toBeVisible()

  await page.getByTestId('damage').click()
  await expect(page.getByTestId('stat-hp')).toContainText('7 / 12')
  await page.reload()
  await expect(page.getByTestId('stat-hp')).toContainText('7 / 12')
  await expect(page.getByTestId('undo')).toBeEnabled()
  await page.getByTestId('undo').click()
  await expect(page.getByTestId('stat-hp')).toContainText('12 / 12')
  await expect(page.getByText(/revision 4$/)).toBeVisible()
})
