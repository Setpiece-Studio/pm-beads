// ABOUTME: E2E specs for the board view — toggling via the display popover, status and
// ABOUTME: project columns, card-to-panel navigation, and drag-to-column status changes.

import { expect, test } from '@playwright/test'
import { bdShow, readSeed } from './support/bd'

const seed = readSeed()

// Running order matters: 03-board-nav already moved Beta to in_progress, so the
// board starts from In Progress (Alpha, Beta), Open (Delta), Done (Gamma).
const columns = '[data-board-column]'
const columnHeaders = '[data-board-column] header'

test('display popover toggles to board view and writes the URL param', async ({
  page,
}) => {
  await page.goto('/issues')
  await expect(page.getByText('Alpha task')).toBeVisible()

  // Hydration guard: retry opening the popover until the view toggle renders.
  await expect(async () => {
    await page.getByRole('button', { name: 'Display' }).click()
    await expect(page.getByRole('button', { name: 'Board' })).toBeVisible({
      timeout: 2000,
    })
  }).toPass()

  await page.getByRole('button', { name: 'Board' }).click()
  await expect(page).toHaveURL(/view=board/)

  // Columns read as a left-to-right pipeline: open → in progress → done.
  await expect(page.locator(columnHeaders)).toHaveText([
    /Open\s*1/,
    /In Progress\s*2/,
    /Done\s*1/,
  ])
  await expect(
    page.locator(`[data-board-card="${seed.alphaId}"]`),
  ).toBeVisible()
})

test('board columns follow the active grouping', async ({ page }) => {
  await page.goto('/issues?view=board&grouping=project')
  // Closed issues are hidden outside status grouping, so Gamma drops out.
  await expect(page.locator(columnHeaders)).toHaveText([
    /E2E Epic\s*2/,
    /No project\s*1/,
  ])
})

test('board card click navigates to the issue detail route', async ({
  page,
}) => {
  await page.goto('/issues?view=board')
  // Hydration guard: retry the card click until the route navigates.
  await expect(async () => {
    await page.locator(`[data-board-card="${seed.deltaId}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.deltaId}`), {
      timeout: 5000,
    })
  }).toPass()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/view=board/)
})

test('dragging a card to another column round-trips the status through bd', async ({
  page,
}) => {
  await page.goto('/issues?view=board')
  await expect(page.locator(columns)).toHaveCount(3)

  // Hydration guard: prove the page is interactive before the one-shot drag.
  await expect(async () => {
    await page.locator(`[data-board-card="${seed.deltaId}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.deltaId}`), {
      timeout: 5000,
    })
  }).toPass()
  await page.goBack()
  await expect(page).toHaveURL(/view=board/)

  const card = page.locator(`[data-board-card="${seed.deltaId}"]`)
  const target = page.locator('[data-board-column="in_progress"]')
  const cardBox = await card.boundingBox()
  const targetBox = await target.boundingBox()
  if (!cardBox || !targetBox) throw new Error('card or column not laid out')

  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 15 },
  )
  // Pointer movement returns before React necessarily commits collision detection.
  await expect(target).toHaveClass(/ring-1/)
  await page.mouse.up()

  // Delta moves to In Progress; the now-empty Open column disappears.
  await expect(page.locator(columnHeaders)).toHaveText([
    /In Progress\s*3/,
    /Done\s*1/,
  ])
  // The drop did not also navigate to the detail route.
  await expect(page).not.toHaveURL(new RegExp(`/issues/${seed.deltaId}`))

  // And the write landed in the throwaway bd database itself.
  const issue = await bdShow(seed.deltaId)
  expect(issue.status).toBe('in_progress')
})
