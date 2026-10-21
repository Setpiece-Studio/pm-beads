// ABOUTME: E2E spec for bead-id autolinks in markdown — a description that names another bead
// ABOUTME: renders it as a chip reading as that bead's title, and clicking the chip navigates.
// ABOUTME: Also captures the light/dark screenshots of a chip in a description.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { readSeed } from './support/bd'

const seed = readSeed()

const SHOT_DIR = join(process.cwd(), 'test-results', 'bead-links')

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true })
})

test('a bead id in a description renders as a chip that navigates', async ({
  page,
}) => {
  await page.goto(`/issues/${seed.deltaId}`)
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()

  const chip = page.locator(`a[data-bead-chip="${seed.betaId}"]`)
  await expect(chip).toBeVisible()
  // The chip is prose: it reads as the bead's title, and the id is hover text.
  await expect(chip).toContainText('Beta bug')
  await expect(chip).not.toContainText(seed.betaId)
  await expect(chip).toHaveAttribute('title', `Beta bug · ${seed.betaId}`)

  await page.screenshot({
    path: join(SHOT_DIR, 'bead-chip-light.png'),
    fullPage: false,
  })

  await chip.click()

  await expect(page).toHaveURL(new RegExp(`/issues/${seed.betaId}`))
  await expect(page.getByRole('heading', { name: 'Beta bug' })).toBeVisible()
})

test('a bead chip renders in dark mode too', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark')
  })
  await page.goto(`/issues/${seed.deltaId}`)

  const chip = page.locator(`a[data-bead-chip="${seed.betaId}"]`)
  await expect(chip).toBeVisible()

  await page.screenshot({
    path: join(SHOT_DIR, 'bead-chip-dark.png'),
    fullPage: false,
  })
})
