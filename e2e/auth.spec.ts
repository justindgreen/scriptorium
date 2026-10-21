import { expect, test, type Page } from '@playwright/test'

/**
 * First-run flow: setup wizard -> administrator home -> create an invite -> sign out ->
 * register a player through the invite link -> player home -> admin pages are off limits ->
 * sign back in as administrator and see both users.
 *
 * Runs serially on the desktop project only; the mobile project covers layout from M1.4.
 */
test.describe.configure({ mode: 'serial' })

const admin = {
  username: 'gamemaster',
  displayName: 'Game Master',
  password: 'correct-horse-battery',
}
const player = {
  username: 'player-one',
  displayName: 'Player One',
  password: 'another-fine-password',
}
let inviteUrl = ''

test.skip(({ isMobile }) => isMobile, 'Desktop project only')

async function signOut(page: Page) {
  // Sign out lives in the account menu; only one trigger is visible per viewport.
  await page.locator('[data-testid=account-menu]:visible').click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
}

test('a fresh instance leads to the setup wizard and creates the administrator', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set up Scriptorium')

  await page.getByLabel('Instance name').fill('Thursday Table')
  await page.getByLabel('Your display name').fill(admin.displayName)
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password', { exact: true }).fill(admin.password)
  await page.getByLabel('Confirm password').fill(admin.password)
  await page.getByRole('button', { name: 'Create administrator' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Welcome, ${admin.displayName}`)
  await expect(page.getByTestId('my-role')).toHaveText('Administrator')
  await expect(page.getByTestId('instance-name')).toHaveText('Thursday Table')
})

test('the setup wizard is no longer reachable', async ({ page }) => {
  await page.goto('/setup')
  await expect(page).toHaveURL(/\/(login)?$/)
})

test('the administrator creates an invite and signs out', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('link', { name: 'Invites' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Invites')
  await page.getByLabel('Note (optional)').fill('first player')
  await page.getByRole('button', { name: 'Create invite' }).click()
  const url = await page.getByTestId('invite-url').textContent()
  expect(url).toMatch(/\/register\?invite=[A-Z2-9-]+$/)
  inviteUrl = url ?? ''
  await expect(page.getByRole('cell', { name: 'active', exact: true })).toBeVisible()

  await signOut(page)
})

test('a player registers through the invite link and cannot reach admin pages', async ({
  page,
}) => {
  await page.goto(new URL(inviteUrl).pathname + new URL(inviteUrl).search)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account')
  await expect(page.getByLabel('Invite code')).not.toHaveValue('')
  await page.getByLabel('Display name').fill(player.displayName)
  await page.getByLabel('Username').fill(player.username)
  await page.getByLabel('Password', { exact: true }).fill(player.password)
  await page.getByLabel('Confirm password').fill(player.password)
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('my-role')).toHaveText('Player')
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0)

  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/$/)

  await signOut(page)
})

test('the invite cannot be used a second time', async ({ page }) => {
  await page.goto(new URL(inviteUrl).pathname + new URL(inviteUrl).search)
  await page.getByLabel('Display name').fill('Second')
  await page.getByLabel('Username').fill('second-player')
  await page.getByLabel('Password', { exact: true }).fill(player.password)
  await page.getByLabel('Confirm password').fill(player.password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('alert')).toContainText(/invite/i)
  await expect(page).toHaveURL(/\/register/)
})

test('a wrong password is rejected and the administrator sees both users', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill(admin.username)
  await page.getByLabel('Password').fill('not-the-password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).not.toBeEmpty()

  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('link', { name: 'Users' }).click()
  await expect(page.getByTestId(`user-row-${admin.username}`)).toBeVisible()
  await expect(page.getByTestId(`user-row-${player.username}`)).toContainText('Active')
})
