// ABOUTME: E2E flow from editable agent settings to @mention autocomplete in a real comment.

import { expect, test } from '@playwright/test'
import { readSeed } from './support/bd'

const seed = readSeed()

test('saving an agent makes it available to comment @mentions', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'You' })).toBeVisible()
  await expect(page.getByText('@ben')).toBeVisible()
  // The button is SSR-visible before React attaches its handler. The new input proves the
  // click reached the hydrated component rather than disappearing during startup.
  await expect(async () => {
    await page.getByRole('button', { name: 'Add agent' }).click()
    await expect(page.getByLabel('Agent handle')).toBeVisible({ timeout: 2000 })
  }).toPass()
  await page.getByLabel('Agent handle').fill('data-engineer')
  await page.getByLabel('Tmux session').fill('daryl')
  await page.getByLabel('Aliases').fill('Daryl, Data')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved.')

  await page.goto(`/issues/${seed.alphaId}`)
  const composer = page.getByLabel('Leave a comment')
  await expect(async () => {
    await page.getByRole('button', { name: 'Load comments' }).click()
    await expect(composer).toBeVisible({ timeout: 2000 })
  }).toPass()
  await expect(composer).toBeVisible()
  const option = page.getByRole('option', { name: /@data-engineer/ })
  // As with the existing comment-posting spec, the textarea is visible before hydration.
  // The suggestion proves both React state and the freshly saved root persona context landed.
  await expect(async () => {
    await composer.fill('Please check this @Dar')
    await expect(option).toBeVisible({ timeout: 2000 })
  }).toPass()
  await expect(option).toContainText('Daryl, Data')
  await composer.press('Enter')
  await expect(composer).toHaveValue('Please check this @data-engineer ')
})
