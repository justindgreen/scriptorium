import { expect, test } from '@playwright/test'
import { admin, ensureSetup, expectAccessible, signInAs } from './helpers'

test.beforeEach(async ({ request }) => {
  await ensureSetup(request)
})

test('sign-in page is accessible and the theme toggle persists across reloads', async ({
  page,
}) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expectAccessible(page)

  const html = page.locator('html')
  await expect(html).not.toHaveClass(/dark/)
  await page.getByTestId('theme-toggle').click() // system -> light
  await page.getByTestId('theme-toggle').click() // light -> dark
  await expect(html).toHaveClass(/dark/)
  await page.reload()
  await expect(html).toHaveClass(/dark/)
  await expectAccessible(page)
})

test('the shell adapts to the viewport and every admin page passes the accessibility scan', async ({
  page,
  isMobile,
}) => {
  await signInAs(page, admin.username, admin.password)
  await expectAccessible(page)

  if (isMobile) {
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeHidden()
    await page.getByTestId('open-navigation').click()
    const drawer = page.getByRole('dialog')
    await expect(drawer.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    await drawer.getByRole('link', { name: 'Users' }).click()
    await expect(page).toHaveURL(/\/admin\/users$/)
    await expect(drawer).toBeHidden()
  } else {
    const sidebar = page.getByRole('complementary', { name: 'Sidebar' })
    await expect(sidebar).toBeVisible()
    await sidebar.getByRole('link', { name: 'Users' }).click()
    await expect(page).toHaveURL(/\/admin\/users$/)
    await expect(sidebar.getByRole('link', { name: 'Users' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible()
  await expectAccessible(page)

  for (const [path, heading] of [
    ['/admin/invites', 'Invites'],
    ['/admin/audit', 'Audit log'],
    ['/admin/settings', 'Settings'],
    ['/admin/backups', 'Backups'],
  ] as const) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expectAccessible(page)
  }
})

test('the command palette navigates and switches theme', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard shortcut is a desktop affordance')
  await signInAs(page, admin.username, admin.password)
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('audit')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/admin\/audit$/)

  await page.keyboard.press('Control+k')
  await page.keyboard.type('dark theme')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expectAccessible(page)
})

test('settings changes are reflected in the shell', async ({ page }) => {
  await signInAs(page, admin.username, admin.password)
  await page.goto('/admin/settings')
  const input = page.getByLabel('Instance name')
  const original = await input.inputValue()
  await input.fill('Renamed Table')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Settings saved')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Renamed Table' }).first()).toBeVisible()
  await input.fill(original)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Settings saved').last()).toBeVisible()
})
