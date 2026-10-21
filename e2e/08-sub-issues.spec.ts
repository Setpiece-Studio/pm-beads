// ABOUTME: E2E specs for the issue detail's sub-issues section — the header ring and child rows,
// ABOUTME: collapse/expand, and the inline composer filing a real child under the right parent.

import { expect, test } from '@playwright/test'
import { bdShow, readSeed } from './support/bd'

const seed = readSeed()

test('the sub-issues header shows progress and lists the children', async ({
  page,
}) => {
  await page.goto(`/projects/${seed.epicId}`)
  await expect(page.getByRole('heading', { name: 'E2E Epic' })).toBeVisible()

  await expect(page.getByRole('heading', { name: 'Sub-issues' })).toBeVisible()
  // Four seeded children — Alpha, Beta, Gamma and the Nested Epic the hierarchy fixtures
  // file under this one — with Gamma closed, so the header ring reads 1/4.
  await expect(page.getByText('1/4').last()).toBeVisible()

  // Open work sorts ahead of closed work: Gamma (closed) is the last row.
  const rows = page.locator('[data-sub-issues-list] a')
  await expect(rows.filter({ hasText: 'Alpha task' })).toBeVisible()
  await expect(rows.filter({ hasText: 'Beta bug' })).toBeVisible()
  await expect(rows.filter({ hasText: 'Nested Epic' })).toBeVisible()
  await expect(rows.filter({ hasText: 'Gamma chore' })).toBeVisible()
  await expect(rows.last()).toContainText('Gamma chore')
})

test('the caret collapses and re-expands the sub-issues list', async ({
  page,
}) => {
  await page.goto(`/projects/${seed.epicId}`)
  await expect(page.getByText('Alpha task')).toBeVisible()

  // Hydration guard: the caret is SSR-rendered, so a click before React attaches is a no-op.
  await expect(async () => {
    await page.getByRole('button', { name: 'Collapse sub-issues' }).click()
    await expect(page.getByText('Alpha task')).toBeHidden({ timeout: 5000 })
  }).toPass()
  // The header survives the collapse so the section can be reopened.
  await expect(page.getByRole('heading', { name: 'Sub-issues' })).toBeVisible()

  await page.getByRole('button', { name: 'Expand sub-issues' }).click()
  await expect(page.getByText('Alpha task')).toBeVisible()
})

test('the inline composer creates a child filed under the open issue', async ({
  page,
}) => {
  // Delta is the standalone seeded issue — it starts with no children at all.
  await page.goto(`/issues/${seed.deltaId}`)
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sub-issues' })).toBeVisible()

  // Hydration guard wraps only opening the composer — the create itself is not idempotent.
  await expect(async () => {
    await page.getByRole('button', { name: 'Add sub-issues' }).click()
    await expect(page.getByLabel('Issue title')).toBeVisible({ timeout: 5000 })
  }).toPass()

  const title = 'Composed sub-issue'
  await page.getByLabel('Issue title').fill(title)
  await page.getByLabel('Add description').fill('filed from the e2e composer')
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  // The created child renders as a row without waiting on a navigation, and the ring counts it.
  const row = page
    .locator('[data-sub-issues-list] a')
    .filter({ hasText: title })
  await expect(row).toBeVisible()
  await expect(page.getByText('0/1')).toBeVisible()

  const href = await row.getAttribute('href')
  const createdId = href?.match(/\/issues\/([^?]+)/)?.[1]
  expect(createdId).toBeTruthy()
  // Created flat then re-parented: a `bd create --parent` id would carry a dotted suffix.
  expect(createdId).not.toContain('.')

  // bd records the parent — the round-trip, not just the optimistic row.
  const created = await bdShow(createdId as string)
  expect(created.parent).toBe(seed.deltaId)
  expect(created.description).toBe('filed from the e2e composer')

  // A reload proves the row comes back from the loader, not from local component state.
  await page.reload()
  await expect(
    page.locator('[data-sub-issues-list] a').filter({ hasText: title }),
  ).toBeVisible()
})
