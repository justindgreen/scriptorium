import { expect, test } from '@playwright/test'
import { expectAccessible } from './helpers'

test('licence attribution is public and lists the bundled SRD', async ({ page }) => {
  await page.goto('/licenses')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Licences and attribution' }),
  ).toBeVisible()
  const srd = page.getByTestId('license-srd-5.1')
  await expect(srd).toContainText('System Reference Document 5.1')
  await expect(srd).toContainText('CC-BY-4.0')
  await expect(srd).toContainText('Creative Commons Attribution 4.0 International License')
  await expectAccessible(page)
})

test('bundled content is seeded and searchable through the API once signed in', async ({
  request,
}) => {
  const res = await request.get('/api/trpc/content.licenses')
  const body = (await res.json()) as {
    result: { data: Array<{ slug: string; entryCount: number }> }
  }
  const srd = body.result.data.find((s) => s.slug === 'srd-5.1')
  expect(srd).toBeDefined()
  expect(srd!.entryCount).toBeGreaterThan(1500)
})
