import { expect, test, type Locator, type Page } from '@playwright/test'
import { admin, buildCharacter, ensureSetup, expectAccessible, signInAs } from './helpers'

async function press(locator: Locator) {
  await expect(locator).toBeEnabled()
  await locator.focus()
  await locator.press('Enter')
}

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const

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

test('ability score methods: unique standard array, bounded point buy, server-rolled scores', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000)
  await signInAs(page, admin.username, admin.password)
  const stamp = Date.now().toString(36)

  // Standard array: every value once; picking a used value swaps the two abilities (issue #3).
  await page.goto('/characters/new')
  await page.getByTestId('builder-name').fill(`Array ${testInfo.project.name} ${stamp}`)
  await expect(page.getByTestId('ability-str')).toHaveValue('15')
  await page.getByTestId('ability-dex').selectOption('15')
  await expect(page.getByTestId('ability-dex')).toHaveValue('15')
  await expect(page.getByTestId('ability-str')).toHaveValue('14')
  const assigned = await Promise.all(
    ABILITIES.map((a) => page.getByTestId(`ability-${a}`).inputValue()),
  )
  expect([...assigned].sort()).toEqual(['10', '12', '13', '14', '15', '8'])
  await press(page.getByTestId('builder-create'))
  await expect(page).toHaveURL(/\/characters\/[0-9a-f-]+$/)
  await expect(page.getByTestId('score-dex')).toHaveText('15')
  await expect(page.getByTestId('score-str')).toHaveText('14')

  // Point buy: six 8s and 27 points; each step costs its table price; the controls stop at the budget.
  await page.goto('/characters/new')
  await page.getByTestId('builder-name').fill(`Points ${testInfo.project.name} ${stamp}`)
  await page.getByTestId('builder-method').selectOption('point_buy')
  await expect(page.getByTestId('pb-points')).toContainText('27 of 27 points left')
  for (const a of ABILITIES) await expect(page.getByTestId(`ability-${a}`)).toHaveText('8')
  for (let i = 0; i < 7; i += 1) await press(page.getByTestId('pb-inc-str'))
  await expect(page.getByTestId('ability-str')).toHaveText('15')
  await expect(page.getByTestId('pb-inc-str')).toBeDisabled()
  await expect(page.getByTestId('pb-points')).toContainText('18 of 27 points left')
  for (let i = 0; i < 7; i += 1) await press(page.getByTestId('pb-inc-dex'))
  for (let i = 0; i < 5; i += 1) await press(page.getByTestId('pb-inc-con'))
  for (let i = 0; i < 4; i += 1) await press(page.getByTestId('pb-inc-int'))
  await expect(page.getByTestId('pb-points')).toContainText('0 of 27 points left')
  await expect(page.getByTestId('pb-inc-wis')).toBeDisabled()
  await expect(page.getByTestId('pb-dec-str')).toBeEnabled()
  await press(page.getByTestId('builder-create'))
  await expect(page).toHaveURL(/\/characters\/[0-9a-f-]+$/)
  await expect(page.getByTestId('score-str')).toHaveText('15')
  await expect(page.getByTestId('score-int')).toHaveText('12')
  await expect(page.getByTestId('score-cha')).toHaveText('8')

  // Rolled: nothing to create until the server has rolled; the sheet carries exactly those scores.
  await page.goto('/characters/new')
  await page.getByTestId('builder-name').fill(`Dice ${testInfo.project.name} ${stamp}`)
  await page.getByTestId('builder-method').selectOption('rolled')
  await expect(page.getByTestId('builder-create')).toBeDisabled()
  await expect(page.getByTestId('rolled-scores')).toHaveCount(0)
  await press(page.getByTestId('roll-abilities'))
  await expect(page.getByTestId('rolled-scores').locator('li')).toHaveCount(6)
  const rolledText = await page.getByTestId('rolled-scores').locator('li').allTextContents()
  const rolled = rolledText.map((t) => Number(t.trim().split(/\s+/)[0]))
  for (const r of rolled) {
    expect(r).toBeGreaterThanOrEqual(3)
    expect(r).toBeLessThanOrEqual(18)
  }
  const chosen = await Promise.all(
    ABILITIES.map((a) => page.getByTestId(`ability-${a}`).inputValue()),
  )
  expect(chosen.map(Number).sort((a, b) => a - b)).toEqual([...rolled].sort((a, b) => a - b))
  await press(page.getByTestId('builder-create'))
  await expect(page).toHaveURL(/\/characters\/[0-9a-f-]+$/)
  for (const [i, a] of ABILITIES.entries())
    await expect(page.getByTestId(`score-${a}`)).toHaveText(chosen[i]!)
})

test('language choices keep earlier picks and show on the sheet', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await signInAs(page, admin.username, admin.password)
  const name = `Linguist ${testInfo.project.name} ${Date.now().toString(36)}`
  await buildCharacter(page, name, {
    label: 'Fighter',
    species: 'Hill Dwarf',
    background: 'Acolyte',
  })
  const key = 'background:srd-5.1:background:acolyte/languages'
  const choice = page.getByTestId(`choice-${key}`)
  await expect(choice).toContainText('choose 2 more')
  // One of two slots, saved alone (issue #5): the pick survives and the other slot stays open.
  await choice.getByTestId(`slot-${key}-0`).selectOption('elvish')
  await press(choice.getByTestId(`save-${key}`))
  await expect(choice).toContainText('choose 1 more')
  await expect(choice.getByTestId(`chosen-${key}`)).toContainText('Elvish')
  await expect(choice.getByTestId(`slot-${key}-1`)).toHaveCount(0)
  await expect(choice.getByTestId(`slot-${key}-0`).locator('option[value="elvish"]')).toBeDisabled()
  await choice.getByTestId(`slot-${key}-0`).selectOption('celestial')
  await press(choice.getByTestId(`save-${key}`))
  await expect(choice).toBeHidden()
  await page.reload()
  await expect(page.getByTestId('proficiencies-languages')).toContainText('Elvish')
  await expect(page.getByTestId('proficiencies-languages')).toContainText('Celestial')
})
