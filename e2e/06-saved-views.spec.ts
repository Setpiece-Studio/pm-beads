// ABOUTME: E2E spec for saved views — save the current board+filter as a named view on the
// ABOUTME: throwaway project, re-apply it from the tabs row after a reset, and delete it.

import { expect, test } from '@playwright/test'

test('save, apply, and delete a view from the tabs row', async ({ page }) => {
  // Start from a non-default issues view: board mode filtered to bugs.
  await page.goto('/issues?view=board&filter=type%3Ais%3Abug')
  await expect(page.getByText('Beta bug')).toBeVisible()

  // Hydration guard: retry opening the save popover until the name input renders.
  await expect(async () => {
    await page.getByRole('button', { name: 'Save current view' }).click()
    await expect(page.getByRole('textbox', { name: 'View name' })).toBeVisible({
      timeout: 2000,
    })
  }).toPass()

  await page.getByRole('textbox', { name: 'View name' }).fill('Bug board')
  await page.getByRole('button', { name: 'Save view' }).click()

  // The new tab appears and is active for the current params.
  const tab = page.getByRole('button', { name: 'Bug board', exact: true })
  await expect(tab).toBeVisible()
  await expect(tab).toHaveAttribute('aria-current', 'page')

  // Reset to the default view; the All tab takes over.
  await page.getByRole('button', { name: 'All issues' }).click()
  await expect(page).not.toHaveURL(/view=board/)
  await expect(
    page.getByRole('button', { name: 'All issues' }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(tab).not.toHaveAttribute('aria-current', 'page')

  // Clicking the saved tab restores the captured params.
  await tab.click()
  await expect(page).toHaveURL(/view=board/)
  await expect(page).toHaveURL(/filter=type%3Ais%3Abug/)
  await expect(tab).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Beta bug')).toBeVisible()

  // Delete the view from its tab; the tab disappears and stays gone on reload.
  await tab.hover()
  await page.getByRole('button', { name: 'Delete view Bug board' }).click()
  await expect(tab).toBeHidden()
  await page.reload()
  await expect(page.getByRole('button', { name: 'All issues' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Bug board', exact: true }),
  ).toBeHidden()
})
