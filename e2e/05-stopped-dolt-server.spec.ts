// ABOUTME: E2E specs for a server-mode project with dolt auto-start disabled and its server
// ABOUTME: stopped — the app must name the project and the command that starts it.

import { expect, test } from '@playwright/test'
import {
  E2E_STOPPED_SERVER_PROJECT_DIR,
  E2E_STOPPED_SERVER_PROJECT_NAME,
} from './support/bd'

const STOPPED_NAME = E2E_STOPPED_SERVER_PROJECT_NAME

test('a stopped, externally managed dolt server is reported with its start command', async ({
  page,
}) => {
  await page.goto(
    `/issues?project=${encodeURIComponent(E2E_STOPPED_SERVER_PROJECT_DIR)}`,
  )

  await expect(
    page.getByRole('heading', { name: /Couldn.t open this beads project/ }),
  ).toBeVisible()
  await expect(
    page.getByText(`Dolt server for ${STOPPED_NAME} is not running.`),
  ).toBeVisible()
  await expect(page.getByText('bd dolt start')).toBeVisible()
  // The friendly panel replaced the route, and the shell (with the picker) survived.
  await expect(page.getByText('Alpha task')).toBeHidden()
  await expect(page.getByRole('link', { name: 'Issues' })).toBeVisible()
})

test('every view reports the stopped server rather than a raw bd failure', async ({
  page,
}) => {
  for (const route of ['/issues', '/projects', '/memories', '/inbox']) {
    await page.goto(
      `${route}?project=${encodeURIComponent(E2E_STOPPED_SERVER_PROJECT_DIR)}`,
    )
    await expect(page.getByText(/Dolt server for .* is not running/)).toBeVisible()
    await expect(page.getByText(/Command failed/)).toHaveCount(0)
  }
})
