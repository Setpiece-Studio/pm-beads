// ABOUTME: E2E specs for legacy (pre-Dolt) beads workspaces — the picker must not list one,
// ABOUTME: and opening one by URL must render the friendly error with the picker still usable.

import { expect, test } from '@playwright/test'
import {
  E2E_LEGACY_PROJECT_DIR,
  E2E_LEGACY_PROJECT_NAME,
  E2E_PROJECT_NAME,
} from './support/bd'

const DEFAULT_NAME = E2E_PROJECT_NAME
const LEGACY_NAME = E2E_LEGACY_PROJECT_NAME

/** Opens the sidebar project picker, retrying past hydration. */
async function openPicker(
  page: import('@playwright/test').Page,
  buttonName: string,
) {
  await expect(async () => {
    await page.getByRole('button', { name: buttonName }).click()
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible({
      timeout: 2000,
    })
  }).toPass()
}

test('the picker does not list a legacy pre-Dolt beads directory', async ({
  page,
}) => {
  await page.goto('/issues')
  await expect(page.getByText('Alpha task')).toBeVisible()

  await openPicker(page, DEFAULT_NAME)
  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByText(`${DEFAULT_NAME} (default)`, { exact: true }),
  ).toBeVisible()
  await expect(dialog.getByText(LEGACY_NAME, { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('every view shows the friendly error rather than a raw stack dump', async ({
  page,
}) => {
  for (const route of ['/issues', '/projects', '/memories', '/inbox']) {
    await page.goto(
      `${route}?project=${encodeURIComponent(E2E_LEGACY_PROJECT_DIR)}`,
    )
    await expect(
      page.getByRole('heading', { name: /Couldn.t open this beads project/ }),
    ).toBeVisible()
    await expect(page.getByText(/Command failed/)).toHaveCount(0)
  }
})

test('opening a legacy project by URL shows the friendly error and keeps the picker usable', async ({
  page,
}) => {
  await page.goto(
    `/issues?project=${encodeURIComponent(E2E_LEGACY_PROJECT_DIR)}`,
  )

  await expect(
    page.getByRole('heading', { name: /Couldn.t open this beads project/ }),
  ).toBeVisible()
  await expect(
    page.getByText(/Not a Dolt-backed beads project/i),
  ).toBeVisible()
  await expect(page.getByText(E2E_LEGACY_PROJECT_DIR)).toBeVisible()
  // The raw route content never rendered, but the shell did.
  await expect(page.getByText('Alpha task')).toBeHidden()
  await expect(page.getByRole('link', { name: 'Issues' })).toBeVisible()

  // The picker still works, so the user can get back to a project that opens.
  await openPicker(page, LEGACY_NAME)
  await page
    .getByRole('dialog')
    .getByText(`${DEFAULT_NAME} (default)`, { exact: true })
    .click()
  await expect(page).not.toHaveURL(/project=/)
  await expect(page.getByText('Alpha task')).toBeVisible()
})
