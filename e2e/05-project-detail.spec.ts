// ABOUTME: E2E specs for the project/epic detail route — epic navigation renders progress and
// ABOUTME: children, child rows link to issue detail, Back preserves the projects view, deps persist.

import { expect, test } from '@playwright/test'
import { readSeed } from './support/bd'

const seed = readSeed()

test('clicking an epic renders progress and a children list', async ({
  page,
}) => {
  await page.goto('/projects')

  // Hydration guard: retry the epic-row click until the detail route renders.
  await expect(async () => {
    await page.getByRole('button', { name: new RegExp(seed.epicId) }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${seed.epicId}`), {
      timeout: 5000,
    })
  }).toPass()

  await expect(page.getByRole('heading', { name: 'E2E Epic' })).toBeVisible()

  // Epic progress: one of four children (Gamma) is closed → 1/4. The fraction renders twice —
  // the epic's Progress section and the sub-issues header ring count the same children.
  await expect(page.getByText('Progress')).toBeVisible()
  await expect(page.getByText('1/4').first()).toBeVisible()

  // The recursive children list renders all four child issues, including the nested epic.
  await expect(page.getByText('Sub-issues')).toBeVisible()
  await expect(page.getByText('Alpha task')).toBeVisible()
  await expect(page.getByText('Nested Epic')).toBeVisible()
  await expect(page.getByText('Beta bug')).toBeVisible()
  await expect(page.getByText('Gamma chore')).toBeVisible()
})

test('browser Back from a project detail preserves the projects-view filter', async ({
  page,
}) => {
  await page.goto('/projects?filter=status:open')
  await expect(page).toHaveURL(/filter=status/)
  await expect(page.getByText('E2E Epic')).toBeVisible()

  await expect(async () => {
    await page.getByRole('button', { name: new RegExp(seed.epicId) }).click()
    await expect(page).toHaveURL(new RegExp(`/projects/${seed.epicId}`), {
      timeout: 5000,
    })
  }).toPass()
  await expect(page.getByRole('heading', { name: 'E2E Epic' })).toBeVisible()

  await page.goBack()
  // The exact prior list URL is restored from history, the filter param and all.
  await expect(page).toHaveURL(/filter=status/)
  await expect(page).not.toHaveURL(new RegExp(`/projects/${seed.epicId}`))
  await expect(page.getByText('E2E Epic')).toBeVisible()
})

test('a child issue row navigates to the issue detail route', async ({
  page,
}) => {
  await page.goto(`/projects/${seed.epicId}`)
  await expect(page.getByRole('heading', { name: 'E2E Epic' })).toBeVisible()

  await page.getByText('Alpha task').click()
  await expect(page).toHaveURL(new RegExp(`/issues/${seed.alphaId}`))
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()
})

test('the project rail does not duplicate children as a parent-child group', async ({
  page,
}) => {
  await page.goto(`/projects/${seed.epicId}`)
  await expect(page.getByRole('heading', { name: 'E2E Epic' })).toBeVisible()

  // Epic children appear once, in the dedicated body section — the rail does NOT duplicate them
  // as a parent-child group (hideParentChild). "Sub-issues" is the body heading only.
  await expect(page.getByRole('heading', { name: 'Sub-issues' })).toHaveCount(1)
})

test('a dependency added on the project persists through the full app+bd round-trip', async ({
  page,
}) => {
  await page.goto(`/projects/${seed.epicId}`)
  await expect(page.getByRole('heading', { name: 'E2E Epic' })).toBeVisible()

  // Add a "Related" link to Delta via the rail's picker — the same full dependency editor the
  // issue detail uses. The "Related" group only renders from the loader's bd show of the epic,
  // so its appearance proves bd accepted the symmetric relate AND the route re-read it.
  //
  // The relate is NOT idempotent (a retry can't re-pick Delta once it's excluded as already
  // linked), so the hydration guard wraps only opening the picker to step 1 — then the Related
  // choice and the Delta selection each run once, outside the retry.
  await expect(async () => {
    await page.getByRole('button', { name: /Add relationship/ }).click()
    await expect(page.getByRole('option', { name: 'Related' })).toBeVisible({
      timeout: 3000,
    })
  }).toPass()
  await page.getByRole('option', { name: 'Related' }).click()
  await page.getByRole('option', { name: /Delta feature/ }).click()

  await expect(page.getByRole('heading', { name: 'Related' })).toBeVisible()
  await expect(page.getByText('Delta feature')).toBeVisible()

  // Clean up so downstream specs see a coherent seed: remove the link, confirm the group
  // disappears (the route re-read shows bd no longer records the edge).
  await expect(async () => {
    await page
      .getByRole('button', { name: `Remove Related ${seed.deltaId}` })
      .click()
    await expect(page.getByRole('heading', { name: 'Related' })).toBeHidden({
      timeout: 5000,
    })
  }).toPass()
})
