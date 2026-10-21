// ABOUTME: E2E specs for the project picker — opening the command dialog, discovering the
// ABOUTME: seeded projects, switching projects via the URL param, and returning to default.

import { expect, test } from '@playwright/test'
import { E2E_PROJECT_NAME, E2E_SECOND_PROJECT_NAME } from './support/bd'

const DEFAULT_NAME = E2E_PROJECT_NAME
const SECOND_NAME = E2E_SECOND_PROJECT_NAME

test('picker opens and lists the discovered seeded projects', async ({
  page,
}) => {
  await page.goto('/issues')
  await expect(page.getByText('Alpha task')).toBeVisible()

  // Hydration guard: retry opening the picker until the dialog renders.
  await expect(async () => {
    await page.getByRole('button', { name: DEFAULT_NAME }).click()
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible({
      timeout: 2000,
    })
  }).toPass()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(`${DEFAULT_NAME} (default)`, { exact: true })).toBeVisible()
  await expect(dialog.getByText(SECOND_NAME, { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
})

test('switching projects updates the URL and the issues view', async ({
  page,
}) => {
  await page.goto('/issues')
  await expect(page.getByText('Alpha task')).toBeVisible()

  await expect(async () => {
    await page.getByRole('button', { name: DEFAULT_NAME }).click()
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible({
      timeout: 2000,
    })
  }).toPass()

  await page
    .getByRole('dialog')
    .getByText(SECOND_NAME, { exact: true })
    .click()

  // The project param carries the second project's path; its issues replace ours.
  await expect(page).toHaveURL(/project=/)
  await expect(page.getByText('Second project task')).toBeVisible()
  await expect(page.getByText('Alpha task')).toBeHidden()

  // Sidebar nav preserves the project param when switching views. Wait for the
  // picker button to show the new project first — links re-render in the same
  // pass, so this avoids clicking a stale href mid-transition.
  await expect(page.getByRole('button', { name: SECOND_NAME })).toBeVisible()
  await page.getByRole('link', { name: 'Projects' }).click()
  await expect(page).toHaveURL(/\/projects\?.*project=/)

  // Switch back to the default project: the param is removed.
  await expect(async () => {
    await page.getByRole('button', { name: SECOND_NAME }).click()
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible({
      timeout: 2000,
    })
  }).toPass()
  await page
    .getByRole('dialog')
    .getByText(`${DEFAULT_NAME} (default)`, { exact: true })
    .click()
  await expect(page).not.toHaveURL(/project=/)
  // Same stale-href guard: wait for the sidebar to show the default project.
  await expect(page.getByRole('button', { name: DEFAULT_NAME })).toBeVisible()
  await page.getByRole('link', { name: 'Issues' }).click()
  await expect(page.getByText('Alpha task')).toBeVisible()
})

test('each project keeps its own issues view state', async ({ page }) => {
  await page.goto('/issues?filter=type%3Ais%3Abug')
  await expect(page.getByText('Beta bug')).toBeVisible()

  await expect(async () => {
    await page.getByRole('button', { name: DEFAULT_NAME }).click()
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible({
      timeout: 2000,
    })
  }).toPass()
  await page
    .getByRole('dialog')
    .getByText(SECOND_NAME, { exact: true })
    .click()
  await expect(page.getByText('Second project task')).toBeVisible()
  await expect
    .poll(() => new URL(page.url()).searchParams.has('filter'))
    .toBe(false)

  await expect(async () => {
    await page.getByRole('button', { name: SECOND_NAME }).click()
    await expect(page.getByPlaceholder('Search projects...')).toBeVisible({
      timeout: 2000,
    })
  }).toPass()
  await page
    .getByRole('dialog')
    .getByText(`${DEFAULT_NAME} (default)`, { exact: true })
    .click()
  await expect(page).toHaveURL(/filter=type%3Ais%3Abug/)
  await expect(page.getByText('Beta bug')).toBeVisible()
  await expect(page.getByText('Alpha task')).toHaveCount(0)
})
