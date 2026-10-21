import { expect, test } from '@playwright/test'

test('the server reports readiness', async ({ request }) => {
  const response = await request.get('/readyz')
  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ status: 'ok', checks: { database: 'ok' } })
})

test('unknown paths fall back to the app shell', async ({ page }) => {
  const response = await page.goto('/characters/does-not-exist-yet')
  expect(response?.status()).toBe(200)
  // The shell renders and routes client-side (to the wizard or sign-in, depending on state).
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('unknown API paths return 404 JSON', async ({ request }) => {
  const response = await request.get('/api/does-not-exist')
  expect(response.status()).toBe(404)
  expect(await response.json()).toEqual({ error: 'Not found' })
})

test('the OpenAPI document lists the public health route', async ({ request }) => {
  const response = await request.get('/api/v1/openapi.json')
  expect(response.status()).toBe(200)
  const doc = (await response.json()) as { openapi: string; paths: Record<string, unknown> }
  expect(doc.openapi).toMatch(/^3\./)
  expect(doc.paths).toHaveProperty('/health')
})
