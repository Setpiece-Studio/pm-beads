// ABOUTME: E2E specs for the issue detail route — list-row navigation, browser Back preserving
// ABOUTME: list filters, the legacy ?issue= redirect, not-found deep links, and the board drag guard.

import { expect, test } from '@playwright/test'
import { bdShow, readSeed } from './support/bd'

const seed = readSeed()

const columns = '[data-board-column]'

test('clicking a list row navigates to the issue detail route', async ({
  page,
}) => {
  await page.goto('/issues')

  // Hydration guard: retry the row click until the route navigates and renders.
  await expect(async () => {
    await page.getByText('Delta feature').click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.deltaId}`), {
      timeout: 5000,
    })
  }).toPass()

  // The detail shell renders the title as a heading plus the issue's body.
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()
  await expect(page.getByText('standalone issue without a project')).toBeVisible()
  // The body no longer repeats the issue id — the detail top bar carries it in the breadcrumb.
  await expect(page).toHaveURL(new RegExp(seed.deltaId))
  // The drawer is gone: no dialog sheet mounts.
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('browser Back returns to the list with filters intact', async ({
  page,
}) => {
  await page.goto('/issues?grouping=project')
  await expect(page).toHaveURL(/grouping=project/)

  await expect(async () => {
    await page.getByText('Delta feature').click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.deltaId}`), {
      timeout: 5000,
    })
  }).toPass()

  await page.goBack()
  // The exact prior list URL is restored from history, grouping param and all.
  await expect(page).toHaveURL(/grouping=project/)
  await expect(page).not.toHaveURL(new RegExp(`/issues/${seed.deltaId}`))
  await expect(page.getByText('Delta feature')).toBeVisible()
})

test('a legacy ?issue= URL redirects to the detail route', async ({ page }) => {
  await page.goto(`/issues?issue=${seed.deltaId}`)
  await expect(page).toHaveURL(new RegExp(`/issues/${seed.deltaId}`))
  await expect(page).not.toHaveURL(/issue=/)
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()
})

test('a blocker dependency row navigates to that issue and Back walks the chain', async ({
  page,
}) => {
  await page.goto(`/issues/${seed.alphaId}`)
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()

  // Alpha is blocked by Beta (seed edge): the rail shows a Blocked by group.
  await expect(page.getByText('Blocked by')).toBeVisible()
  await page.getByText('Beta bug').click()
  await expect(page).toHaveURL(new RegExp(`/issues/${seed.betaId}`))
  await expect(page.getByRole('heading', { name: 'Beta bug' })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()
})

test('deep-linking a non-existent id renders the not-found component', async ({
  page,
}) => {
  await page.goto('/issues/e2e-does-not-exist')
  await expect(page.getByText('Issue not found')).toBeVisible()
  // Not the generic error component or a crash.
  await expect(page.getByText("Couldn’t load this issue")).toBeHidden()
})

test('an epic opened under /issues redirects to the project route', async ({
  page,
}) => {
  await page.goto(`/issues/${seed.epicId}`)
  // KTD12: an epic's canonical home is the project route (built in a later unit).
  await expect(page).toHaveURL(new RegExp(`/projects/${seed.epicId}`))
})

test('changing status on the detail route is reflected on the list after Back', async ({
  page,
}) => {
  // Board view groups by status: a card lives in the column named for its status, so a
  // status change moves the card between columns — a concrete "list reflects it" assertion.
  await page.goto('/issues?view=board')
  await expect(page.locator(columns)).not.toHaveCount(0)

  // Delta is a standalone open feature; safe to flip and flip back.
  await expect(async () => {
    await page.locator(`[data-board-card="${seed.deltaId}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.deltaId}`), {
      timeout: 5000,
    })
  }).toPass()
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()

  // Edit status to Blocked via the rail's Status select.
  await page.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Blocked' }).click()
  // The rail reflects the returned issue instantly.
  await expect(page.getByLabel('Status')).toContainText('Blocked')

  await page.goBack()
  await expect(page).toHaveURL(/view=board/)
  // The invalidated list re-renders: Delta now lives in the Blocked column.
  await expect(
    page.locator(
      `[data-board-column="blocked"] [data-board-card="${seed.deltaId}"]`,
    ),
  ).toBeVisible()

  // Restore the seed so downstream specs see Delta as an open issue again.
  await page.locator(`[data-board-card="${seed.deltaId}"]`).click()
  await expect(page).toHaveURL(new RegExp(`/issues/${seed.deltaId}`))
  await page.getByLabel('Status').click()
  await page.getByRole('option', { name: 'Open' }).click()
  await expect(page.getByLabel('Status')).toContainText('Open')
  await page.goBack()
  await expect(
    page.locator(
      `[data-board-column="open"] [data-board-card="${seed.deltaId}"]`,
    ),
  ).toBeVisible()
})

test('changing type on the detail route is reflected and persisted', async ({
  page,
}) => {
  // Delta is a standalone feature; flip it to a task and back so downstream specs see the seed.
  await page.goto(`/issues/${seed.deltaId}`)
  await expect(
    page.getByRole('heading', { name: 'Delta feature' }),
  ).toBeVisible()
  await expect(page.getByLabel('Type')).toContainText('Feature')

  await page.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Task' }).click()
  // The rail reflects the returned issue instantly, and bd records the new type.
  await expect(page.getByLabel('Type')).toContainText('Task')
  expect((await bdShow(seed.deltaId)).issue_type).toBe('task')

  // Restore the seed type for downstream specs.
  await page.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Feature' }).click()
  await expect(page.getByLabel('Type')).toContainText('Feature')
  expect((await bdShow(seed.deltaId)).issue_type).toBe('feature')
})

test('dragging a board card does not navigate to the detail route', async ({
  page,
}) => {
  await page.goto('/issues?view=board')
  await expect(page.locator(columns)).not.toHaveCount(0)

  // Hydration guard: prove the page is interactive before the one-shot drag.
  await expect(async () => {
    await page.locator(`[data-board-card="${seed.deltaId}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/issues/${seed.deltaId}`), {
      timeout: 5000,
    })
  }).toPass()
  await page.goBack()
  await expect(page).toHaveURL(/view=board/)

  const card = page.locator(`[data-board-card="${seed.deltaId}"]`)
  const cardBox = await card.boundingBox()
  if (!cardBox) throw new Error('card not laid out')

  // Drag the card and drop it within its own column: a no-op status-wise, but it
  // must still suppress the click→navigate (justDraggedRef guard).
  await page.mouse.move(
    cardBox.x + cardBox.width / 2,
    cardBox.y + cardBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    cardBox.x + cardBox.width / 2 + 40,
    cardBox.y + cardBox.height / 2 + 10,
    { steps: 10 },
  )
  await page.mouse.up()

  // The drag did not navigate to the issue detail.
  await expect(page).not.toHaveURL(new RegExp(`/issues/${seed.deltaId}`))
  await expect(page).toHaveURL(/view=board/)
})

// Read the ids of Alpha's "Blocked by" neighbors (bd show's dependencies[]) so the test asserts
// on bd's own state, not just the UI.
async function alphaBlockerIds(): Promise<string[]> {
  const show = await bdShow(seed.alphaId)
  const deps = (show.dependencies ?? []) as Array<{
    id: string
    dependency_type: string
  }>
  return deps.filter((d) => d.dependency_type === 'blocks').map((d) => d.id)
}

test('editing dependencies: remove the seeded blocker then add it back', async ({
  page,
}) => {
  // Seed: Beta blocks Alpha → Alpha shows Beta under "Blocked by".
  expect(await alphaBlockerIds()).toContain(seed.betaId)

  await page.goto(`/issues/${seed.alphaId}`)
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()
  await expect(page.getByText('Blocked by')).toBeVisible()

  // Establish hydration through the reversible picker, then perform removal exactly once.
  await expect(async () => {
    await page.getByRole('button', { name: /Add relationship/ }).click()
    await expect(page.getByRole('option', { name: 'Blocked by' })).toBeVisible({ timeout: 3000 })
  }).toPass()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: `Remove Blocked by ${seed.betaId}` }).click()
  await expect(page.getByRole('heading', { name: 'Blocked by', exact: true })).toBeHidden()
  // bd no longer records the blocks edge (read once now that no app write is in flight —
  // a test-side bd show racing the app's write would contend for the single-writer lock).
  expect(await alphaBlockerIds()).not.toContain(seed.betaId)

  // Add it back: open the picker, choose "Blocked by", select Beta bug. The add is not
  // idempotent (a retry can't re-pick Beta once it's excluded as already linked), so the
  // hydration guard wraps only opening the picker to step 1; the choices then run once.
  await expect(async () => {
    await page.getByRole('button', { name: /Add relationship/ }).click()
    await expect(page.getByRole('option', { name: 'Blocked by' })).toBeVisible({
      timeout: 3000,
    })
  }).toPass()
  await page.getByRole('option', { name: 'Blocked by' }).click()
  await page.getByRole('option', { name: /Beta bug/ }).click()
  await expect(page.getByText('Blocked by')).toBeVisible()
  // bd records the blocks edge again — restoring the seed for downstream specs.
  expect(await alphaBlockerIds()).toContain(seed.betaId)
})
