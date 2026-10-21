// ABOUTME: E2E spec for the issues toolbar's Sweep merged PRs action — a bead linked to a PR the
// ABOUTME: gh shim reports as merged is closed, and the summary panel names it.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { bdShow, runBd, runBdJson } from './support/bd'

// The shim reports 43 (and only 43) as merged for this repo, so a bead on 42 must survive.
const MERGED_PR = 'https://github.com/e2e-owner/e2e-repo/pull/43'
const OPEN_PR = 'https://github.com/e2e-owner/e2e-repo/pull/42'

/** Screenshots of the summary panel land here — gitignored, and named in the PR description. */
const SHOT_DIR = join(process.cwd(), 'test-results', 'pr-sweep')

let mergedBeadId: string
let openBeadId: string

async function createLinkedBead(title: string, prUrl: string): Promise<string> {
  const created = (await runBdJson([
    'create',
    title,
    '--type',
    'task',
    '--priority',
    '2',
    '--json',
  ])) as { id: string }
  await runBd(['update', created.id, '--set-metadata', `pr_url=${prUrl}`])
  return created.id
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true })
  // Fresh beads rather than the shared seed: this spec CLOSES what it links, and the seeded
  // issues carry the group counts every other spec asserts on.
  mergedBeadId = await createLinkedBead('Bead whose PR merged', MERGED_PR)
  openBeadId = await createLinkedBead('Bead whose PR is still open', OPEN_PR)
})

/** Open the toolbar's sweep panel. Hydration guard: the trigger is server-rendered before its
 * click handler attaches, so a too-early click is silently dropped. */
async function openSweepPanel(page: Page) {
  await expect(async () => {
    await page
      .getByRole('button', { name: 'Sweep merged PRs' })
      .click({ timeout: 5000 })
    await expect(page.getByRole('button', { name: 'Sweep now' })).toBeVisible({
      timeout: 5000,
    })
  }).toPass()
}

test('previewing the sweep names the bead without touching it', async ({
  page,
}) => {
  await page.goto('/issues')
  await openSweepPanel(page)
  await page.getByRole('button', { name: 'Preview' }).click()

  const summary = page.getByTestId('sweep-summary')
  await expect(summary).toContainText('Dry run')
  await expect(summary).toContainText('Closed 1')
  await expect(summary).toContainText(mergedBeadId)

  // A dry run writes nothing: the bead is still open and carries no sweep comment.
  expect((await bdShow(mergedBeadId)).status).toBe('open')
  expect(await runBd(['comments', mergedBeadId])).not.toContain('pm-beads')
})

test('sweeping closes the bead whose PR merged and leaves the others alone', async ({
  page,
}) => {
  await page.goto('/issues')
  await openSweepPanel(page)
  await page.getByRole('button', { name: 'Sweep now' }).click()

  const summary = page.getByTestId('sweep-summary')
  await expect(summary).toContainText('Closed 1')
  await expect(summary).toContainText(mergedBeadId)
  await expect(summary).toContainText('Bead whose PR merged')
  await expect(summary).toContainText('#43')
  await expect(summary).not.toContainText('Dry run')

  await page.screenshot({
    path: join(SHOT_DIR, 'sweep-summary-light.png'),
    fullPage: false,
  })

  // The bead really is closed, with the sweep's own comment on it, signed pm-beads.
  const swept = await bdShow(mergedBeadId)
  expect(swept.status).toBe('closed')
  expect(swept.close_reason).toBe('PR #43 merged')
  const comments = await runBd(['comments', mergedBeadId])
  expect(comments).toContain('pm-beads')
  expect(comments).toContain(`Closed: PR #43 merged ${MERGED_PR}`)

  // The bead on the still-open PR is untouched.
  expect((await bdShow(openBeadId)).status).toBe('open')
})

test('the summary panel renders in dark mode too', async ({ page }) => {
  // A fresh linked bead, created here rather than in beforeAll: the sweep above would have
  // closed it, and this test needs a populated summary to be worth screenshotting.
  const darkBeadId = await createLinkedBead(
    'Bead swept in dark mode',
    MERGED_PR,
  )
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark')
  })
  await page.goto('/issues')
  await openSweepPanel(page)
  // Preview, not a real sweep: this test is about how the panel reads, not what it writes.
  await page.getByRole('button', { name: 'Preview' }).click()

  const summary = page.getByTestId('sweep-summary')
  await expect(summary).toContainText('Dry run')
  await expect(summary).toContainText(darkBeadId)
  await page.screenshot({
    path: join(SHOT_DIR, 'sweep-summary-dark.png'),
    fullPage: false,
  })
})
