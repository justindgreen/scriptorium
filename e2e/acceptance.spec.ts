import { expect, test, type Locator, type Page } from '@playwright/test'
import { admin, buildCharacter, ensureSetup, restartServer, signInAs } from './helpers'

/**
 * The acceptance scenario of docs/PRODUCT_SPEC.md §16 on alpha content (Gate A1): a DM creates a
 * campaign and invites a player; the player registers, joins, builds and submits a first-level
 * character; the DM approves it, shares a homebrew source, gives the character a magic item and
 * sees its mechanics; the DM runs an encounter with monsters, initiative, turns and an attack;
 * the server restarts mid-encounter and the retried attack command applies once; the player
 * sees the encounter without monster hit points.
 */
async function press(locator: Locator) {
  await expect(locator).toBeEnabled()
  await locator.focus()
  await locator.press('Enter')
}

async function testIdOf(locator: Locator, prefix: string): Promise<string> {
  const id = await locator.getAttribute('data-testid')
  expect(id).toBeTruthy()
  return id!.slice(prefix.length)
}

async function trpc<T>(page: Page, path: string, input: unknown): Promise<T> {
  const response = await page.request.post(`/api/trpc/${path}`, { data: input })
  expect(response.ok(), `${path} failed: ${await response.text()}`).toBe(true)
  return ((await response.json()) as { result: { data: T } }).result.data
}

test('the acceptance scenario runs end to end, across a restart, with a retried attack', async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(600_000)
  await ensureSetup(request)
  const stamp = Date.now().toString(36)

  // The DM signs in and issues an instance invite for a new player.
  await signInAs(page, admin.username, admin.password)
  const invite = await trpc<{ code: string }>(page, 'admin.invites.create', {
    role: 'user',
    note: 'acceptance',
  })
  const playerContext = await browser.newContext()
  const player = await playerContext.newPage()
  await player.goto(`/register?invite=${invite.code}`)
  await player.getByLabel('Display name').fill('Pip')
  await player.getByLabel('Username').fill(`pip${stamp}`)
  await player.getByLabel('Password', { exact: true }).fill('correct-horse-battery')
  await player.getByLabel('Confirm password').fill('correct-horse-battery')
  await player.getByRole('button', { name: 'Create account' }).click()
  await expect(player).toHaveURL(/\/$/)

  // Campaign and invite link.
  await page.goto('/campaigns')
  await page.getByTestId('campaign-name').fill(`Acceptance ${stamp}`)
  await press(page.getByTestId('campaign-create'))
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]{36}$/)
  const campaignId = page.url().split('/').pop()!
  await press(page.getByTestId('invite-create'))
  const joinUrl = (await page.getByTestId('invite-url').textContent())!.trim()
  expect(joinUrl).toMatch(/\/campaigns\/join\?code=[A-Z2-9-]+$/)

  // The player joins, builds a first-level fighter and submits it.
  const join = new URL(joinUrl)
  await player.goto(join.pathname + join.search)
  await press(player.getByTestId('join-campaign'))
  await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}$`))
  await expect(player.getByTestId('campaign-role')).toHaveText('player')
  const heroName = `Pip ${stamp}`
  await buildCharacter(player, heroName, {
    label: 'Fighter',
    species: 'Human',
    background: 'Acolyte',
  })
  await player.goto(`/campaigns/${campaignId}`)
  await expect(player.getByTestId('campaign-role')).toHaveText('player')
  await expect(player.getByTestId('submit-character-select')).toContainText(heroName, {
    timeout: 30_000,
  })
  await player.getByTestId('submit-character-select').selectOption({ label: heroName })
  await press(player.getByTestId('submit-character'))
  const partyRow = player.locator('[data-testid^="party-"]').filter({ hasText: heroName })
  await expect(partyRow).toContainText('pending')
  const characterId = await testIdOf(partyRow, 'party-')

  // The DM approves the character.
  await page.reload()
  await press(page.getByTestId(`approve-${characterId}`))
  await expect(page.getByTestId(`party-${characterId}`)).toContainText('approved')

  // A homebrew weapon with an automatic modifier and charges, shared with the campaign, given to the character.
  const source = await trpc<{ id: string; slug: string }>(page, 'homebrew.sources.create', {
    name: `Acceptance Forge ${stamp}`,
  })
  const item = await trpc<{ entryId: string; uid: string }>(page, 'homebrew.items.create', {
    sourceId: source.id,
    draft: {
      name: 'Vigil Blade',
      data: {
        category: 'weapon',
        description: 'A +1 longsword with three charges of light.',
        magic: true,
        rarity: 'uncommon',
        requiresAttunement: false,
        weapon: {
          category: 'martial',
          range: 'melee',
          damage: { dice: '1d8', damageType: 'slashing' },
          versatileDamage: '1d10',
          properties: ['versatile', 'magical'],
        },
        charges: { max: 3, recharge: { time: 'dawn' } },
      },
      effects: [
        { type: 'bonus', target: 'attack.weapon.self', value: 1 },
        { type: 'bonus', target: 'damage.weapon.self', value: 1 },
      ],
    },
  })
  await trpc(page, 'homebrew.items.publish', { entryId: item.entryId })
  await page.reload()
  await page.getByTestId('share-source-select').selectOption({ label: `Acceptance Forge ${stamp}` })
  await press(page.getByTestId('share-source'))
  await expect(page.getByTestId('shared-sources')).toContainText(`Acceptance Forge ${stamp}`)
  await page.goto(`/characters/${characterId}`)
  await expect(page.getByRole('heading', { name: heroName })).toBeVisible()
  await page.getByTestId('item-search').fill('vigil')
  await press(page.getByTestId(`add-${item.uid}`))
  await expect(page.getByTestId('inventory')).toContainText('Vigil Blade')
  await expect(page.getByTestId('inventory')).toContainText('3/3 charges')
  // STR 16 (+3) + proficiency 2 + the blade's 1.
  await expect(page.getByTestId('action-templates')).toContainText('Vigil Blade +6')
  // The player sees it on their own sheet too.
  await player.goto(`/characters/${characterId}`)
  await expect(player.getByTestId('action-templates')).toContainText('Vigil Blade +6')

  // The encounter: party plus two alpha monsters, initiative, start.
  await page.goto(`/campaigns/${campaignId}`)
  await page.getByTestId('encounter-name').fill('Crypt')
  await press(page.getByTestId('encounter-create'))
  await expect(page).toHaveURL(/\/encounters\/[0-9a-f-]{36}$/)
  const encounterId = page.url().split('/').pop()!
  await page.getByTestId('add-character-select').selectOption({ label: heroName })
  await press(page.getByTestId('add-character'))
  await expect(page.getByTestId('participants')).toContainText(heroName)
  await page.getByTestId('monster-search').fill('skeleton')
  await press(page.getByTestId('add-monster-srd-5.1:monster:skeleton'))
  await expect(page.getByTestId('participants')).toContainText('Skeleton 1')
  await page.getByTestId('monster-search').fill('skeleton')
  await press(page.getByTestId('add-monster-srd-5.1:monster:skeleton'))
  await expect(page.getByTestId('participants')).toContainText('Skeleton 2')
  await press(page.getByTestId('roll-initiative'))
  await expect(page.locator('[data-testid^="initiative-"]')).toHaveCount(3)
  await press(page.getByTestId('start-encounter'))
  await expect(page.getByText(/active · round 1, turn 1/)).toBeVisible()
  await expect(page.locator('[aria-current="true"]')).toHaveCount(1)

  // The fighter attacks Skeleton 1 with the blade; the roll is applied through the coordinator.
  await page.getByTestId('attacker-select').selectOption({ label: heroName })
  const actionLabels = await page.getByTestId('action-select').locator('option').allTextContents()
  const bladeLabel = actionLabels.find((l) => l.startsWith('Vigil Blade'))
  expect(bladeLabel, actionLabels.join(' | ')).toBeTruthy()
  await page.getByTestId('action-select').selectOption({ label: bladeLabel! })
  await page.getByTestId('target-select').selectOption({ label: 'Skeleton 1' })
  await expect(page.getByTestId('attack-plan')).toContainText('+6 to hit')
  await press(page.getByTestId('attack-roll'))
  await expect(page.getByTestId('attack-rolled')).toContainText('Attack roll')
  const skeletonRow = page
    .locator('[data-testid^="participant-"]')
    .filter({ hasText: 'Skeleton 1' })
  const hpBefore = await skeletonRow.locator('[data-testid^="hp-"]').textContent()
  const commitRequest = page.waitForRequest(
    (r) => r.url().includes('encounters.commitAttack') && r.method() === 'POST',
  )
  await press(page.getByTestId('attack-apply'))
  const sent = await commitRequest
  const commitBody = sent.postData()!
  const commitUrl = sent.url()
  await expect(page.getByTestId('attack-result')).toContainText(/hit|miss/)
  await expect(page.getByTestId('encounter-log')).toContainText(/hit|miss/)
  const hpAfter = await skeletonRow.locator('[data-testid^="hp-"]').textContent()
  const resultText = (await page.getByTestId('attack-result').textContent()) ?? ''
  if (/\bhit\b/.test(resultText)) expect(hpAfter).not.toBe(hpBefore)
  else expect(hpAfter).toBe(hpBefore)

  // The server restarts in the middle of combat; everything is still there afterwards.
  await restartServer(request)
  await page.reload()
  await expect(page.getByText(/active · round 1, turn 1/)).toBeVisible()
  await expect(page.locator('[data-testid^="participant-"]')).toHaveCount(3)
  await expect(skeletonRow.locator('[data-testid^="hp-"]')).toHaveText(hpAfter!)
  await expect(page.getByTestId('encounter-log')).toContainText(/hit|miss/)
  await expect(page.getByTestId('live-status')).toHaveText('Live', { timeout: 90_000 })

  // The same attack command, retried after the restart, replays its receipt and applies once.
  const retry = await page.request.post(commitUrl, {
    data: commitBody,
    headers: { 'content-type': 'application/json' },
  })
  expect(retry.ok()).toBe(true)
  expect(await retry.text()).toContain('"replayed":true')
  await page.reload()
  await expect(skeletonRow.locator('[data-testid^="hp-"]')).toHaveText(hpAfter!)

  // Next turn, then the player's view: order and log, no monster hit points, no DM controls.
  await press(page.getByTestId('next-turn'))
  await expect(page.getByText(/active · round 1, turn 2/)).toBeVisible()
  await player.goto(`/encounters/${encounterId}`)
  await expect(player.getByTestId('participants')).toContainText('Skeleton 1')
  await expect(player.locator('[data-testid^="hp-"]')).toHaveCount(0)
  await expect(player.getByTestId('attack-panel')).toHaveCount(0)
  await expect(player.getByTestId('dm-controls')).toHaveCount(0)
  await expect(player.getByTestId('encounter-log')).toContainText(/hit|miss/)
  await playerContext.close()
})
