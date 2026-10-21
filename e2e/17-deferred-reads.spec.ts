// ABOUTME: A stalled secondary fetch must not prevent the primary issue from being used.
import { expect, test } from '@playwright/test'
import { readSeed } from './support/bd'

test('issue content stays usable when post-render queries fail', async ({ page }) => {
  const { alphaId } = readSeed()
  // The document carries the primary bead from SSR. Block subsequent server-function
  // fetches to exercise failed badge, navigation, related-data and configuration reads.
  await page.route('**/_serverFn/**', (route) => route.abort())
  await page.goto(`/issues/${alphaId}`)
  await expect(page.getByTestId('issue-title')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry related issues' })).toBeVisible()
  await page.getByLabel('Status', { exact: true }).click()
  await expect(page.getByRole('option', { name: /Open/, exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('issue-title')).toBeVisible()
})
