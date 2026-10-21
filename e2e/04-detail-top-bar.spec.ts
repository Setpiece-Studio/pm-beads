// ABOUTME: E2E specs for the detail top bar — the breadcrumb, and the n/N arrows walking the very
// ABOUTME: list the row was opened from (issues and projects), including the deep-link "—" case.

import { expect, test } from '@playwright/test'
import { E2E_PROJECT_NAME, readSeed } from './support/bd'

const seed = readSeed()

const position = '[data-detail-nav-position]'

// Seeded non-epic issues, in the default list reading order (grouping=status, ordering=priority):
// In Progress [Alpha p1] · Open [Beta p2, Delta p2] · Closed [Gamma p3].
const ISSUE_COUNT = 4

test('the breadcrumb names the project, the section, and the issue', async ({
  page,
}) => {
  await page.goto(`/issues/${seed.alphaId}`)
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(breadcrumb).toContainText(E2E_PROJECT_NAME)
  await expect(breadcrumb.getByRole('link', { name: 'Issues' })).toBeVisible()
  await expect(breadcrumb).toContainText(seed.alphaId)
  await expect(breadcrumb).toContainText('Alpha task')
  await expect(page.getByRole('button', { name: 'Star this issue' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'More issue actions' }),
  ).toBeVisible()
})

test('a deep-linked issue has no list behind it, so it shows no position', async ({
  page,
}) => {
  await page.goto(`/issues/${seed.deltaId}`)
  await expect(page.locator(position)).toHaveText('—')
  await expect(page.getByRole('button', { name: 'Next issue' })).toHaveCount(0)
})

test('the arrows walk the issues list the row was opened from', async ({
  page,
}) => {
  await page.goto('/issues')

  // Hydration guard: retry the row click until the route navigates and renders.
  await expect(async () => {
    await page.getByText('Alpha task').click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.alphaId}`), {
      timeout: 5000,
    })
  }).toPass()

  // Alpha is first: the list's In Progress group leads, so Previous is a dead end.
  await expect(page.locator(position)).toHaveText(`1 / ${ISSUE_COUNT}`)
  await expect(page.getByRole('button', { name: 'Previous issue' })).toBeDisabled()

  await page.getByRole('button', { name: 'Next issue' }).click()
  await expect(page.locator(position)).toHaveText(`2 / ${ISSUE_COUNT}`)
  await expect(page).not.toHaveURL(new RegExp(`/issues/${seed.alphaId}`))
  // The list context rides along, so the position keeps counting the same list.
  await expect(page).toHaveURL(/grouping=status/)

  // Walking to the end disables Next rather than running off the list.
  for (let step = 2; step < ISSUE_COUNT; step += 1) {
    await page.getByRole('button', { name: 'Next issue' }).click()
    await expect(page.locator(position)).toHaveText(
      `${step + 1} / ${ISSUE_COUNT}`,
    )
  }
  await expect(page.getByRole('button', { name: 'Next issue' })).toBeDisabled()

  // Previous retraces the same sequence back to Alpha.
  for (let step = ISSUE_COUNT; step > 1; step -= 1) {
    await page.getByRole('button', { name: 'Previous issue' }).click()
  }
  await expect(page).toHaveURL(new RegExp(`/issues/${seed.alphaId}`))
  await expect(page.locator(position)).toHaveText(`1 / ${ISSUE_COUNT}`)
})

test('a filtered list narrows the positions the arrows walk', async ({
  page,
}) => {
  // Only the two seeded frontend/backend-free issues drop out: the label filter leaves
  // Alpha (frontend) alone, so the detail reports a one-item list.
  await page.goto('/issues?filter=label:is:frontend')

  await expect(async () => {
    await page.getByText('Alpha task').click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.alphaId}`), {
      timeout: 5000,
    })
  }).toPass()

  await expect(page.locator(position)).toHaveText('1 / 1')
  await expect(page.getByRole('button', { name: 'Previous issue' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Next issue' })).toBeDisabled()
})

test('the arrows walk the projects list on the project detail', async ({
  page,
}) => {
  await page.goto('/projects')

  await expect(async () => {
    await page.getByRole('button', { name: new RegExp(seed.epicId) }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${seed.epicId}`), {
      timeout: 5000,
    })
  }).toPass()

  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(breadcrumb.getByRole('link', { name: 'Projects' })).toBeVisible()

  // Open epics only (Done Epic is closed and hidden): E2E Epic p1 leads Lonely and Nested.
  await expect(page.locator(position)).toHaveText('1 / 3')
  await expect(
    page.getByRole('button', { name: 'Previous project' }),
  ).toBeDisabled()

  await page.getByRole('button', { name: 'Next project' }).click()
  await expect(page.locator(position)).toHaveText('2 / 3')
  await expect(page).not.toHaveURL(new RegExp(`/projects/${seed.epicId}`))
})

test('the detail page never scrolls horizontally, even when the title is clipped', async ({
  page,
}) => {
  // A narrow viewport forces the breadcrumb title to truncate rather than widen the page.
  await page.setViewportSize({ width: 700, height: 700 })
  await page.goto(`/issues/${seed.alphaId}`)
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()

  const overflow = await page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth - root.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
})
