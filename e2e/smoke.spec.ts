import { expect, test } from '@playwright/test'

test('the web app loads and reaches the server', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Scriptorium/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scriptorium')
  await expect(page.getByTestId('server-health')).toHaveText(/Server ok/)
})

test('unknown paths fall back to the app shell', async ({ page }) => {
  const response = await page.goto('/characters/does-not-exist-yet')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Scriptorium')
})

test('unknown API paths return 404 JSON', async ({ request }) => {
  const response = await request.get('/api/does-not-exist')
  expect(response.status()).toBe(404)
  expect(await response.json()).toEqual({ error: 'Not found' })
})
