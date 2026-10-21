// ABOUTME: E2E specs for the issue detail activity stream — history-derived events, posting a
// ABOUTME: comment through the composer, and a status edit showing up as an event.

import { expect, test } from '@playwright/test'
import { readSeed, runBdJson } from './support/bd'

const seed = readSeed()

test.beforeEach(async ({ page }) => {
  await page.goto(`/issues/${seed.deltaId}`)
  await expect(page.getByLabel('Leave a comment')).toBeHidden()
  await expect(async () => {
    await page.getByRole('button', { name: 'Load comments' }).click()
    await expect(page.getByLabel('Leave a comment')).toBeVisible({ timeout: 2000 })
  }).toPass()
})

async function commentTexts(id: string): Promise<string[]> {
  const comments = (await runBdJson(['comments', id, '--json'])) as Array<{
    text: string
  }>
  return comments.map((comment) => comment.text)
}

test('the activity stream renders the created event from bd history', async ({
  page,
}) => {
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()

  await expect(page.getByText('Activity')).toBeVisible()
  // The oldest history snapshot yields the creation event, attributed to created_by.
  await expect(page.getByText(/created the issue/)).toBeVisible()
  await expect(page.getByLabel('Leave a comment')).toBeVisible()
})

test('posting a comment shows it in the stream and records it in bd', async ({
  page,
}) => {
  const body = `activity e2e comment ${Date.now()}`
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()

  // Hydration guard: the textarea is SSR-rendered, so a fill before React attaches sets the
  // DOM value but not the component state. Refill until the send button turns enabled — that
  // only happens once React has the draft.
  const composer = page.getByLabel('Leave a comment')
  const send = page.getByLabel('Send comment')
  await expect(async () => {
    await composer.fill(body)
    await expect(send).toBeEnabled({ timeout: 2000 })
  }).toPass()

  await send.click()

  // The posted comment renders as a card in the stream and the draft clears.
  await expect(page.getByText(body)).toBeVisible()
  await expect(composer).toHaveValue('')
  // bd holds it too (read after the write settles — the dolt lock is single-writer).
  expect(await commentTexts(seed.deltaId)).toContain(body)
})

test('a status change on the detail route appears as an activity event', async ({
  page,
}) => {
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()
  await expect(page.getByText('Activity')).toBeVisible()

  // Hydration guard: retry opening the Status select until its options render.
  await expect(async () => {
    await page.getByLabel('Status').click()
    await expect(page.getByRole('option', { name: 'In Progress' })).toBeVisible({
      timeout: 2000,
    })
  }).toPass()
  await page.getByRole('option', { name: 'In Progress' }).click()
  await expect(page.getByLabel('Status')).toContainText('In Progress')

  // The edit bumps updated_at, which re-reads activity: the change lands as an event. Earlier
  // specs (04-board-view) already walked Delta through In Progress, so history can hold more
  // than one such event — assert presence, not uniqueness.
  await expect(
    page.getByText('Status changed from Open to In Progress').first(),
  ).toBeVisible()

  // Restore the seed status for any later spec, and confirm the reverse event too.
  await page.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Open', exact: true }).click()
  await expect(page.getByLabel('Status')).toContainText('Open')
  await expect(
    page.getByText('Status changed from In Progress to Open').first(),
  ).toBeVisible()
})
