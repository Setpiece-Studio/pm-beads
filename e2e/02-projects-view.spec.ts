// ABOUTME: E2E specs for the projects view — epic rows with progress, lazy expansion
// ABOUTME: revealing child issues, and status filtering. Epic clicks route to the detail page.

import { expect, test } from '@playwright/test'
import { readSeed } from './support/bd'

const seed = readSeed()

test('expanding an epic lazily reveals its children', async ({ page }) => {
  await page.goto('/projects')
  await expect(page.getByText('E2E Epic')).toBeVisible()

  // Children are fetched on demand: none of them are in the DOM yet.
  await expect(page.getByText('Alpha task')).toHaveCount(0)

  // Hydration guard: retry the expand click until children render.
  await expect(async () => {
    await page.getByRole('button', { name: 'Expand E2E Epic' }).click()
    await expect(page.getByText('Alpha task')).toBeVisible({ timeout: 5000 })
  }).toPass()
  await expect(page.getByText('Beta bug')).toBeVisible()
  await expect(page.getByText('Gamma chore')).toBeVisible()

  // Collapsing removes the child rows again.
  await page.getByRole('button', { name: 'Collapse E2E Epic' }).click()
  await expect(page.getByText('Alpha task')).toHaveCount(0)
})

test('adding a status filter narrows epic rows and survives reload', async ({
  page,
}) => {
  await page.goto('/projects')
  await expect(page.getByText('E2E Epic')).toBeVisible()

  // Hydration guard: retry the menu flow until the filter lands in the URL.
  // Idempotent — only clicks Filter when the menu is closed, since a second
  // click toggles the popover shut and would wedge every retry after it.
  await expect(async () => {
    if (!(await page.getByRole('option', { name: 'Status' }).isVisible())) {
      await page.getByRole('button', { name: 'Filter' }).click()
    }
    await page.getByRole('option', { name: 'Status' }).click({ timeout: 2000 })
    await page
      .getByRole('option', { name: 'In Progress' })
      .click({ timeout: 2000 })
    await expect(page).toHaveURL(/filter=status/, { timeout: 2000 })
  }).toPass({ timeout: 30_000 })

  // The seeded epic is open, so an in_progress filter hides it.
  await expect(page.getByText('E2E Epic')).toHaveCount(0)
  await expect(page.getByText('No epics match the current filters')).toBeVisible()

  // The filter round-trips through the URL on reload.
  await page.reload()
  await expect(page.getByText('No epics match the current filters')).toBeVisible()
  await expect(page.getByText('E2E Epic')).toHaveCount(0)
})

test('the complete projects view state survives navigation', async ({ page }) => {
  await page.goto('/projects')
  await expect(async () => {
    if (!(await page.getByRole('option', { name: 'Status' }).isVisible())) {
      await page.getByRole('button', { name: 'Filter' }).click()
    }
    await page.getByRole('option', { name: 'Status' }).click({ timeout: 2000 })
    await page
      .getByRole('option', { name: 'In Progress' })
      .click({ timeout: 2000 })
    await expect(page).toHaveURL(/filter=status/, { timeout: 2000 })
  }).toPass({ timeout: 30_000 })

  await expect(async () => {
    await page.getByRole('button', { name: 'Display' }).click()
    await expect(page.getByRole('combobox', { name: 'View' })).toBeVisible({
      timeout: 2000,
    })
  }).toPass()
  await page.getByRole('combobox', { name: 'View' }).click()
  await page.getByRole('option', { name: 'Hierarchy' }).click()
  await expect(page).toHaveURL(/view=tree/)

  await page.getByRole('link', { name: 'Issues', exact: true }).click()
  await page.getByRole('link', { name: 'Projects', exact: true }).click()
  await expect(page).toHaveURL(/view=tree/)
  await expect(page).toHaveURL(/filter=status/)
  await expect(page.getByText('No epics match the current filters')).toBeVisible()
})

test('shows childless epics with 0/0 and reveals closed epics via the status filter', async ({
  page,
}) => {
  await page.goto('/projects')

  // A childless OPEN epic is absent from bd epic status, but the complete-set source still
  // renders it — with 0/0 progress.
  const lonely = page.getByRole('button', { name: 'Expand Lonely Epic' }).locator('..')
  await expect(page.getByText('Lonely Epic')).toBeVisible()
  await expect(lonely.getByText('0/0')).toBeVisible()

  // A closed epic is hidden by default.
  await expect(page.getByText('Done Epic')).toHaveCount(0)

  // Selecting the Closed status reveals it.
  await expect(async () => {
    if (!(await page.getByRole('option', { name: 'Status' }).isVisible())) {
      await page.getByRole('button', { name: 'Filter' }).click()
    }
    await page.getByRole('option', { name: 'Status' }).click({ timeout: 2000 })
    await page.getByRole('option', { name: 'Done' }).click({ timeout: 2000 })
    await expect(page).toHaveURL(/filter=status/, { timeout: 2000 })
  }).toPass({ timeout: 30_000 })

  await expect(page.getByText('Done Epic')).toBeVisible()
})

test('clicking an epic row navigates to the project detail route', async ({
  page,
}) => {
  await page.goto('/projects')
  // The epic id only appears in the epic's own row button.
  await expect(async () => {
    await page.getByRole('button', { name: new RegExp(seed.epicId) }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${seed.epicId}`), {
      timeout: 5000,
    })
  }).toPass()

  // The detail page renders inline (no Sheet dialog) with the epic's title.
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'E2E Epic' })).toBeVisible()
})
