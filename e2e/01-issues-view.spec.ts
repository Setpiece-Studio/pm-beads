// ABOUTME: E2E specs for the issues view — status grouping order and counts, and the
// ABOUTME: display-options popover driving URL search params and regrouping.

import { expect, type Page, test } from '@playwright/test'
import { readSeed } from './support/bd'

const seed = readSeed()

// Group headers are the only buttons inside the issues table.
const groupHeaders = 'table button[aria-expanded]'

/** The remembered issues view for the default project, as the app persists it. */
function readIssuesPreference(page: Page) {
  return page.evaluate(() =>
    JSON.parse(
      window.localStorage.getItem('pm-beads:issues-view:default') ?? 'null',
    ),
  )
}

test('issues view groups by status in canonical order with counts', async ({
  page,
}) => {
  await page.goto('/issues')
  // Seed: Alpha in_progress, Beta + Delta open, Gamma closed; the epic is excluded.
  await expect(page.locator(groupHeaders)).toHaveText([
    /In Progress\s*1/,
    /Open\s*2/,
    /Done\s*1/,
  ])
  await expect(page.getByText('Alpha task')).toBeVisible()
  await expect(page.getByText('Gamma chore')).toBeVisible()
})

test('the blocked issue shows the red unresolved-blocker indicator', async ({
  page,
}) => {
  await page.goto('/issues')
  // Seed: Beta blocks Alpha (Alpha depends on Beta with type blocks; Beta is open). So Alpha's
  // row carries the edge-derived red marker, distinct from the literal blocked-status icon.
  const alphaRow = page.locator('tr', { hasText: 'Alpha task' })
  await expect(alphaRow.getByLabel('Has an unresolved blocker')).toBeVisible()

  // Beta is the blocker, not blocked itself — its row carries no marker.
  const betaRow = page.locator('tr', { hasText: 'Beta bug' })
  await expect(betaRow.getByLabel('Has an unresolved blocker')).toHaveCount(0)
})

test('display options popover changes URL params and regroups', async ({
  page,
}) => {
  await page.goto('/issues')
  await expect(page.getByText('Alpha task')).toBeVisible()

  // Hydration guard: retry opening the popover until the Grouping select renders.
  await expect(async () => {
    await page.getByRole('button', { name: 'Display' }).click()
    await expect(
      page.getByRole('combobox', { name: 'Grouping' }),
    ).toBeVisible({ timeout: 2000 })
  }).toPass()

  await page.getByRole('combobox', { name: 'Grouping' }).click()
  await page.getByRole('option', { name: 'Project' }).click()

  await expect(page).toHaveURL(/grouping=project/)
  // Closed issues are hidden outside status grouping, so Gamma drops out.
  await expect(page.locator(groupHeaders)).toHaveText([
    /E2E Epic\s*2/,
    /No project\s*1/,
  ])

  // Toggling a display property writes the display URL param and hides the column.
  await expect(page.locator('table').getByText(seed.deltaId)).toBeVisible()
  await page.getByRole('button', { name: 'ID', exact: true }).click()
  await expect(page).toHaveURL(/display=/)
  await expect(page.locator('table').getByText(seed.deltaId)).toBeHidden()
})

test('the complete issues view state survives navigation', async ({
  page,
}) => {
  await page.goto('/issues?filter=type%3Ais%3Abug')
  await expect(page.getByText('Beta bug')).toBeVisible()
  // The URL becomes the remembered view in an effect, so it is only remembered once the page
  // has hydrated. The sidebar links are plain anchors and work before that — navigating away
  // too early leaves nothing to restore, which is what made this spec flake on CI.
  await expect.poll(() => readIssuesPreference(page)).toMatchObject({
    filter: 'type:is:bug',
  })
  await page.getByRole('link', { name: 'Projects', exact: true }).click()
  await page.getByRole('link', { name: 'Issues', exact: true }).click()
  await expect(page).toHaveURL(/filter=type%3Ais%3Abug/)

  await expect(async () => {
    await page.getByRole('button', { name: 'Display' }).click()
    await expect(
      page.getByRole('combobox', { name: 'Grouping' }),
    ).toBeVisible({ timeout: 2000 })
  }).toPass()
  await page.getByRole('combobox', { name: 'Grouping' }).click()
  await page.getByRole('option', { name: 'Project' }).click()
  await expect(page).toHaveURL(/grouping=project/)
  await page.getByRole('button', { name: 'ID', exact: true }).click()
  await expect(page).toHaveURL(/display=/)
  expect(await readIssuesPreference(page)).toMatchObject({
    grouping: 'project',
  })

  await page.getByRole('link', { name: 'Projects', exact: true }).click()
  await page.getByRole('link', { name: 'Issues', exact: true }).click()
  await expect(page).toHaveURL(/grouping=project/)
  await expect(page).toHaveURL(/display=/)
  await expect
    .poll(() => new URL(page.url()).searchParams.has('filter'))
    .toBe(true)
  await expect(page.getByText('Beta bug')).toBeVisible()
  await expect(page.getByText('Delta feature')).toHaveCount(0)
  await expect(page.locator('table').getByText(seed.betaId)).toBeHidden()
})
