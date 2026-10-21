// ABOUTME: E2E specs for board/list navigation — list rows navigate to the detail route (no
// ABOUTME: Sheet), and a board drag moves Beta to in_progress for downstream specs.

import { expect, test } from '@playwright/test'
import { bdShow, readSeed } from './support/bd'

const seed = readSeed()

const columnHeaders = '[data-board-column] header'

test('an issues row navigates to the detail route instead of a drawer', async ({
  page,
}) => {
  await page.goto('/issues')

  await expect(async () => {
    await page.getByText('Alpha task').click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.alphaId}`), {
      timeout: 5000,
    })
  }).toPass()

  // The detail route renders inline (no Sheet dialog) with the issue's content.
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()
  await expect(page.getByText('first seeded child')).toBeVisible()
  // Alpha's seeded blocker and label surface on the read-only rail.
  await expect(page.getByText('Blocked by')).toBeVisible()
  await expect(page.getByText('Beta bug')).toBeVisible()
  await expect(page.getByText('frontend')).toBeVisible()
})

test('dragging Beta to In Progress round-trips the status through bd', async ({
  page,
}) => {
  await page.goto('/issues?view=board')
  await expect(page.locator(columnHeaders)).toHaveText([
    /Open\s*2/,
    /In Progress\s*1/,
    /Done\s*1/,
  ])

  // Hydration guard: prove the page is interactive before the one-shot drag.
  await expect(async () => {
    await page.locator(`[data-board-card="${seed.betaId}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.betaId}`), {
      timeout: 5000,
    })
  }).toPass()
  await page.goBack()
  await expect(page).toHaveURL(/view=board/)

  const card = page.locator(`[data-board-card="${seed.betaId}"]`)
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
  // Wait for dnd-kit to register the destination before releasing the pointer.
  await expect(target).toHaveClass(/ring-1/)
  await page.mouse.up()

  // Beta joins Alpha in In Progress; the now-leaner Open column drops to one card.
  await expect(page.locator(columnHeaders)).toHaveText([
    /Open\s*1/,
    /In Progress\s*2/,
    /Done\s*1/,
  ])
  // The drop did not navigate to the detail route.
  await expect(page).not.toHaveURL(new RegExp(`/issues/${seed.betaId}`))

  // And the write landed in the throwaway bd database itself.
  const issue = await bdShow(seed.betaId)
  expect(issue.status).toBe('in_progress')
})
