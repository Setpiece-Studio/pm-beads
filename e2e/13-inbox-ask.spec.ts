// ABOUTME: Needs-you notifications are bead rows with a normal issue panel and icon actions.
// ABOUTME: The row is derived from an open ask.* and leaves the feed when the ask is answered.
import { expect, test } from '@playwright/test'
import { bdShow, runBd, runBdJson } from './support/bd'

const ASK_KEY = 'rollout_order'
const ASK_QUESTION = 'Renderer or exporter first?'

/** One decision nobody has answered, posted with --set-metadata alone — no label, no message.
 * That is the whole claim of the derived filter: the ask IS the notification. */
const OPEN_ASK = JSON.stringify({
  kind: 'decision',
  q: ASK_QUESTION,
  options: ['A: renderer', '★B: exporter'],
  default: 'B',
  default_at: '2026-10-01T00:00:00.000Z',
  by: 'coordinator',
  at: '2026-09-01T00:00:00.000Z',
})

async function createAsk(): Promise<string> {
  const created = (await runBdJson(['create', 'Choose rollout order', '--type', 'task', '--priority', '2', '--actor', 'coordinator', '--json'])) as { id: string }
  await runBd(['update', created.id, '--set-metadata', `ask.${ASK_KEY}=${OPEN_ASK}`, '--actor', 'coordinator'])
  await runBd(['comment', created.id, '--actor', 'coordinator', '--', ASK_QUESTION])
  return created.id
}

async function openAsk(page: import('@playwright/test').Page, id: string) {
  const row = page.getByRole('list', { name: 'Open asks' }).locator(`button[title="Choose rollout order · ${id}"]`)
  await expect(async () => {
    if (!(await row.isVisible())) await page.reload()
    await expect(row).toBeVisible({ timeout: 3000 })
  }).toPass()
  await expect(async () => {
    await row.click()
    await expect(page.getByRole('heading', { name: 'Choose rollout order' })).toBeVisible({ timeout: 5000 })
  }).toPass()
  return row
}

test('Open asks explain why and open compact issue detail', async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 1000 })
  const id = await createAsk()
  await page.goto('/inbox')
  const row = await openAsk(page, id)
  await expect(row).toContainText('coordinator needs your input')
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible()
  const properties = await page.locator('[data-property-group]').boundingBox()
  const body = await page.locator('[data-issue-body]').boundingBox()
  expect(properties).not.toBeNull()
  expect(body).not.toBeNull()
  expect(properties!.y + properties!.height).toBeLessThanOrEqual(body!.y)
  expect(Math.abs(properties!.x - body!.x)).toBeLessThan(30)
  await page.screenshot({ path: test.info().outputPath('inbox-wide.png') })
  await page.setViewportSize({ width: 1100, height: 800 })
  const narrowProperties = await page.locator('[data-property-group]').boundingBox()
  const narrowBody = await page.locator('[data-issue-body]').boundingBox()
  expect(narrowProperties!.y + narrowProperties!.height).toBeLessThanOrEqual(narrowBody!.y)
  // The ask itself is answerable right here — that, not a label button, is how it is resolved.
  await expect(page.locator(`[data-testid="ask-row"][data-ask-key="${ASK_KEY}"]`)).toBeVisible()
  await expect(page.getByRole('button', { name: /Mark.*read/ })).toHaveCount(0)
  await expect(page.getByText('Open bead')).toHaveCount(0)
  // The bead pane wears the same header bar as every other pane in the inbox.
  await expect(page.getByRole('button', { name: 'Star this bead' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'More bead actions' })).toBeVisible()
  await expect(page.locator('header').filter({ hasText: id })).toBeVisible()
})

test('answering the ask takes the bead out of the feed, with no label to clear', async ({ page }) => {
  const id = await createAsk()
  await page.goto('/inbox')
  await openAsk(page, id)

  // An open ask renders expanded, so the answer box is already on screen.
  await page.getByRole('textbox', { name: `Answer ${ASK_QUESTION}` }).fill('A: renderer')
  await page.getByRole('button', { name: 'Submit' }).click()

  await expect(async () => {
    const metadata = ((await bdShow(id)).metadata ?? {}) as Record<string, unknown>
    expect(String(metadata[`ask.${ASK_KEY}`] ?? '')).toContain('"answered_by":"ben"')
  }).toPass()

  await expect(page.getByRole('list', { name: 'Open asks' }).locator(`button[title="Choose rollout order · ${id}"]`)).toHaveCount(0)
  // The completed bead stays open so the submitted answer can be reviewed.
  await expect(page.getByRole('heading', { name: 'Choose rollout order' })).toBeVisible()

  // The row was derived from the open ask, so answering it is what removes it. Retried past
  // the server's 10s bd read cache, which can still be holding the unanswered bead.
  await expect(async () => {
    await page.reload()
    await expect(
      page.getByRole('list', { name: 'Open asks' }).locator(`button[title="Choose rollout order · ${id}"]`),
    ).toHaveCount(0, { timeout: 3000 })
  }).toPass()
})
