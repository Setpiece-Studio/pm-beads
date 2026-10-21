// ABOUTME: E2E spec for the rail's Pull request row — linking a PR by url writes pr_url metadata
// ABOUTME: and renders the number, gh title, and state badge; unlinking drops the key again.

import { expect, type Page, test } from '@playwright/test'
import { bdShow, readSeed } from './support/bd'

const seed = readSeed()

// gh is shimmed onto the dev server's PATH (e2e/support/gh-shim/gh): 42 is open, 43 is merged,
// anything else is unknown to gh and must degrade to the Unknown badge.
const OPEN_PR = 'https://github.com/e2e-owner/e2e-repo/pull/42'
const MERGED_PR = 'https://github.com/e2e-owner/e2e-repo/pull/43'
const UNKNOWN_PR = 'https://github.com/e2e-owner/e2e-repo/pull/99'

/** The bead's pr_url, read straight off `bd show --json` — absent when nothing is linked. */
function prUrlOf(issue: Record<string, unknown>): string | undefined {
  const metadata = issue.metadata as Record<string, unknown> | null | undefined
  const value = metadata?.pr_url
  return typeof value === 'string' ? value : undefined
}

/** The rail's Pull request section. Scoped because state words like "Open" also appear in the
 * rail's Status select right above it. */
function prSection(page: Page) {
  return page.locator('[data-pull-request]')
}

async function linkPr(page: Page, issueId: string, ref: string): Promise<void> {
  await page.goto(`/issues/${issueId}`)
  const section = prSection(page)
  // Hydration guard: the controls are server-rendered before their click handlers attach, so a
  // too-early click is silently dropped and the whole block has to be retried. Every step is
  // explicitly bounded — an unbounded click would wait out the test timeout instead of retrying.
  // The bead may already carry a PR from an earlier test, so start from the empty state.
  await expect(async () => {
    const unlink = section.getByRole('button', { name: 'Unlink pull request' })
    if (await unlink.isVisible()) {
      await unlink.click({ timeout: 5000 })
      await expect(unlink).toBeHidden({ timeout: 5000 })
    }
    await section
      .getByRole('button', { name: 'Link PR…' })
      .click({ timeout: 5000 })
    await expect(section.getByLabel('Pull request url or number')).toBeVisible({
      timeout: 5000,
    })
  }).toPass()
  const input = section.getByLabel('Pull request url or number')
  await input.fill(ref)
  await input.press('Enter')
}

test('linking a PR by url renders the row with its gh title and state badge', async ({
  page,
}) => {
  await linkPr(page, seed.deltaId, MERGED_PR)
  const section = prSection(page)

  await expect(section.getByText('#43', { exact: true })).toBeVisible()
  await expect(section.getByText('Shimmed merged pull request')).toBeVisible()
  await expect(section.getByText('Merged', { exact: true })).toBeVisible()

  // The row links out to the PR itself, in a new tab.
  const link = section.getByRole('link')
  await expect(link).toHaveAttribute('href', MERGED_PR)
  await expect(link).toHaveAttribute('target', '_blank')

  // The convention is a flat pr_url metadata key on the bead.
  expect(prUrlOf(await bdShow(seed.deltaId))).toBe(MERGED_PR)
})

test('linking a different PR replaces the url, and unlinking drops the key', async ({
  page,
}) => {
  // The bead is still linked to the merged PR from the previous test; linkPr clears it first.
  await linkPr(page, seed.deltaId, OPEN_PR)
  const section = prSection(page)
  await expect(section.getByText('Open', { exact: true })).toBeVisible()
  expect(prUrlOf(await bdShow(seed.deltaId))).toBe(OPEN_PR)

  await section
    .getByRole('button', { name: 'Unlink pull request' })
    .click({ timeout: 5000 })
  await expect(section.getByRole('button', { name: 'Link PR…' })).toBeVisible()
  expect(prUrlOf(await bdShow(seed.deltaId))).toBeUndefined()
})

test('a PR gh cannot resolve still renders, with the Unknown badge', async ({
  page,
}) => {
  await linkPr(page, seed.betaId, UNKNOWN_PR)
  const section = prSection(page)

  // exact: '#99' is also a substring of the fallback title "e2e-owner/e2e-repo#99".
  await expect(section.getByText('#99', { exact: true })).toBeVisible()
  await expect(section.getByText('Unknown', { exact: true })).toBeVisible()
  // No gh title, so the row falls back to the url's own owner/repo#N.
  await expect(section.getByText('e2e-owner/e2e-repo#99')).toBeVisible()
})

test('invalid input is rejected inline without touching the bead', async ({
  page,
}) => {
  await linkPr(page, seed.alphaId, 'not-a-pull-request')
  const section = prSection(page)

  await expect(section.getByRole('alert')).toContainText('url or number')
  await expect(section.getByLabel('Pull request url or number')).toBeVisible()
  expect(prUrlOf(await bdShow(seed.alphaId))).toBeUndefined()
})
