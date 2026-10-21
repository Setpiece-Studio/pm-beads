// ABOUTME: E2E spec for the issues toolbar's PR-history backfill — the review list the gh shim's
// ABOUTME: two merged PRs produce, and what applying one high-confidence row writes to the bead.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import {
  bdShow,
  E2E_ORIGIN_REPO,
  E2E_PR_HISTORY_FILE,
  runBd,
  runBdJson,
} from './support/bd'

/** Screenshots of the review panel land here — gitignored, and named in the PR description. */
const SHOT_DIR = join(process.cwd(), 'test-results', 'pr-backfill')

const prUrl = (n: number) => `https://github.com/${E2E_ORIGIN_REPO}/pull/${n}`

let closableId: string
let titleOnlyId: string

async function createBead(title: string): Promise<string> {
  const created = (await runBdJson([
    'create',
    title,
    '--type',
    'task',
    '--priority',
    '2',
    '--json',
  ])) as { id: string }
  return created.id
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true })
  // Fresh beads rather than the shared seed: this spec CLOSES what it links, and the seeded
  // issues carry the group counts every other spec asserts on.
  closableId = await createBead('Bead a merged PR says it closes')
  titleOnlyId = await createBead('Bead only named in a PR title')

  // The shim serves this file for `gh pr list ... headRefName ...`; it has to be written here
  // because its bodies quote the ids bd just minted.
  writeFileSync(
    E2E_PR_HISTORY_FILE,
    JSON.stringify([
      {
        number: 301,
        url: prUrl(301),
        title: 'Ship the closable thing',
        body: `Closes ${closableId}`,
        headRefName: 'feat/closable-thing',
        mergedAt: '2026-08-20T12:00:00Z',
      },
      {
        number: 302,
        url: prUrl(302),
        title: `${titleOnlyId}: named in the title only`,
        body: 'No closing keyword in this body.',
        headRefName: 'feat/title-only',
        mergedAt: '2026-08-19T12:00:00Z',
      },
    ]),
  )
})

test.afterAll(() => {
  // Leave the shim answering with nothing, so a later run of another spec cannot see this one's
  // history. (The scan root is removed at teardown anyway; this is belt and braces.)
  rmSync(E2E_PR_HISTORY_FILE, { force: true })
})

/** Open the toolbar's overflow menu and the backfill panel from it. Hydration guard: the
 * trigger is server-rendered before its click handler attaches, so a too-early click is lost. */
async function openBackfillPanel(page: Page) {
  await expect(async () => {
    await page
      .getByRole('button', { name: 'More issue actions' })
      .click({ timeout: 5000 })
    await page
      .getByRole('menuitem', { name: 'Backfill from PR history…' })
      .click({ timeout: 5000 })
    await expect(page.getByTestId('backfill-panel')).toBeVisible({
      timeout: 5000,
    })
  }).toPass()
  // The panel scans on open; wait for the rows rather than for a spinner to vanish.
  await expect(page.getByTestId('backfill-row').first()).toBeVisible()
}

test('the sweep popover offers the backfill as its own entry point', async ({
  page,
}) => {
  await page.goto('/issues')
  await expect(async () => {
    await page
      .getByRole('button', { name: 'Sweep merged PRs' })
      .click({ timeout: 5000 })
    await expect(
      page.getByRole('button', { name: 'Backfill from PR history…' }),
    ).toBeVisible({ timeout: 5000 })
  }).toPass()

  await page.getByRole('button', { name: 'Backfill from PR history…' }).click()
  await expect(page.getByTestId('backfill-panel')).toBeVisible()
})

test('the review list proposes both PRs, pre-checking only the confident one', async ({
  page,
}) => {
  await page.goto('/issues')
  await openBackfillPanel(page)

  const closable = page.locator(`[data-bead-id="${closableId}"]`)
  const titleOnly = page.locator(`[data-bead-id="${titleOnlyId}"]`)
  await expect(closable).toContainText('high')
  await expect(closable).toContainText('Link + close')
  await expect(titleOnly).toContainText('medium')

  await expect(closable.getByRole('checkbox')).toBeChecked()
  await expect(titleOnly.getByRole('checkbox')).not.toBeChecked()

  await page.screenshot({
    path: join(SHOT_DIR, 'backfill-panel-light.png'),
    fullPage: false,
  })

  // Nothing is written by looking: both beads are still open and unlinked.
  expect((await bdShow(closableId)).status).toBe('open')
  expect((await bdShow(titleOnlyId)).status).toBe('open')
})

test('applying the selected row links and closes the bead', async ({ page }) => {
  await page.goto('/issues')
  await openBackfillPanel(page)

  await page.getByRole('button', { name: /Apply selected/ }).click()

  const results = page.getByTestId('backfill-results')
  await expect(results).toContainText('Applied 1')
  await expect(results).toContainText(closableId)
  await expect(results).toContainText('closed')

  // The bead really is closed, linked to the PR, with the backfill's comment signed pm-beads.
  const applied = await bdShow(closableId)
  expect(applied.status).toBe('closed')
  expect(applied.close_reason).toBe('PR #301 merged')
  expect((applied.metadata as Record<string, unknown>).pr_url).toBe(prUrl(301))
  const comments = await runBd(['comments', closableId])
  expect(comments).toContain('pm-beads')
  expect(comments).toContain('backfilled from PR history (high confidence)')

  // The row that was left unchecked is untouched, and still on offer.
  expect((await bdShow(titleOnlyId)).status).toBe('open')
  await expect(page.locator(`[data-bead-id="${titleOnlyId}"]`)).toBeVisible()
  await expect(page.locator(`[data-bead-id="${closableId}"]`)).toHaveCount(0)
})

test('the review panel renders in dark mode too', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark')
  })
  await page.goto('/issues')
  await openBackfillPanel(page)

  await expect(page.locator(`[data-bead-id="${titleOnlyId}"]`)).toContainText(
    'medium',
  )
  await page.screenshot({
    path: join(SHOT_DIR, 'backfill-panel-dark.png'),
    fullPage: false,
  })
})

test('skipping a row drops it for good', async ({ page }) => {
  await page.goto('/issues')
  await openBackfillPanel(page)

  const titleOnly = page.locator(`[data-bead-id="${titleOnlyId}"]`)
  await titleOnly.getByRole('button', { name: 'Skip' }).click()
  await expect(titleOnly).toHaveCount(0)

  // A rescan does not put it back: the skip lives in the project's sidecar.
  await page.getByRole('button', { name: 'Rescan' }).click()
  await expect(page.getByText(/No beads to backfill/)).toBeVisible()
  expect((await bdShow(titleOnlyId)).status).toBe('open')
})
