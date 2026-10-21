// ABOUTME: E2E specs for the projects hierarchy view — parent-to-child epic nesting with
// ABOUTME: collapse, the show-tasks reveal of non-epic children, and the display view switch.

import { expect, test } from '@playwright/test'

test('hierarchy view nests a child epic under its parent; collapse hides it', async ({
  page,
}) => {
  await page.goto('/projects?view=tree')
  await expect(page.getByText('E2E Epic')).toBeVisible()
  // Nested Epic is a child of E2E Epic, so the hierarchy shows it nested and expanded.
  await expect(page.getByText('Nested Epic')).toBeVisible()

  // Collapsing the parent hides the child epic — behavior unique to the tree (the flat
  // list never nests one epic under another). Hydration guard: retry until the click lands.
  await expect(async () => {
    await page.getByRole('button', { name: 'Collapse E2E Epic' }).click()
    await expect(page.getByText('Nested Epic')).toHaveCount(0, { timeout: 2000 })
  }).toPass()

  await page.getByRole('button', { name: 'Expand E2E Epic' }).click()
  await expect(page.getByText('Nested Epic')).toBeVisible()
})

test('show-tasks lazily reveals the non-epic children under an epic', async ({
  page,
}) => {
  await page.goto('/projects?view=tree')
  await expect(page.getByText('E2E Epic')).toBeVisible()

  // Tasks are fetched on demand: the work item is not in the DOM yet.
  await expect(page.getByText('Alpha task')).toHaveCount(0)

  // Hydration guard: retry the reveal until the fetched task renders.
  await expect(async () => {
    await page.getByRole('button', { name: 'Show tasks for E2E Epic' }).click()
    await expect(page.getByText('Alpha task')).toBeVisible({ timeout: 5000 })
  }).toPass()

  // Toggling it off removes the revealed tasks again.
  await page.getByRole('button', { name: 'Hide tasks for E2E Epic' }).click()
  await expect(page.getByText('Alpha task')).toHaveCount(0)
})

test('the display popover switches to the tree view and writes the URL param', async ({
  page,
}) => {
  await page.goto('/projects')
  await expect(page.getByText('E2E Epic')).toBeVisible()

  // Hydration guard: retry opening the popover until the View select renders.
  await expect(async () => {
    await page.getByRole('button', { name: 'Display' }).click()
    await expect(page.getByRole('combobox', { name: 'View' })).toBeVisible({
      timeout: 2000,
    })
  }).toPass()

  await page.getByRole('combobox', { name: 'View' }).click()
  await page.getByRole('option', { name: 'Hierarchy' }).click()
  await expect(page).toHaveURL(/view=tree/)
  await expect(page.getByText('Nested Epic')).toBeVisible()
})
