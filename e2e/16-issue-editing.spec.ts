// ABOUTME: E2E specs for editing bead prose from the issue detail page — the description block
// ABOUTME: (add, rewrite, clear, cancel) and the inline title, each checked against bd's own state.

import { expect, type Page, test } from '@playwright/test'
import { bdShow, readSeed, runBd } from './support/bd'

const seed = readSeed()

/** Cmd on macOS, Ctrl elsewhere — the editor accepts either. */
const SAVE_KEY = 'ControlOrMeta+Enter'

/** Exact, because the read-only block's pencil is labelled "Edit description" and getByLabel
 * matches on substring by default. */
function descriptionEditor(page: Page) {
  return page.getByLabel('Description', { exact: true })
}

test('adds, rewrites and clears a description, and bd agrees each time', async ({
  page,
}) => {
  // Gamma is seeded with no description at all, so it starts on the add affordance.
  await page.goto(`/issues/${seed.gammaId}`)
  await expect(page.getByRole('heading', { name: 'Gamma chore' })).toBeVisible()

  // Hydration guard: the affordance is SSR-rendered, so a click before React attaches
  // its handler is a no-op — retry until the editor actually opens.
  await expect(async () => {
    await page.getByTestId('description-add').click()
    await expect(descriptionEditor(page)).toBeVisible({ timeout: 5000 })
  }).toPass()

  await descriptionEditor(page).fill(
    `First body with a **bold** word and a bead ref: ${seed.betaId}`,
  )
  await page.keyboard.press(SAVE_KEY)

  // The editor closes and the body re-renders as markdown, bead chip and all.
  await expect(page.getByTestId('description-editor')).toBeHidden()
  const display = page.getByTestId('description-display')
  await expect(display.locator('strong')).toHaveText('bold')
  await expect(display.getByRole('link', { name: /Beta bug/ })).toBeVisible()
  expect(await bdShow(seed.gammaId)).toHaveProperty(
    'description',
    `First body with a **bold** word and a bead ref: ${seed.betaId}`,
  )

  // The chip is still a link: clicking it follows the reference rather than opening the editor.
  await display.getByRole('link', { name: /Beta bug/ }).click()
  await expect(page).toHaveURL(new RegExp(`/issues/${seed.betaId}`))
  await page.goBack()

  // Rewrite it. The pencil is the affordance that works wherever the pointer lands — a body
  // click would follow the chip this description ends with. The editor is seeded with the SOURCE.
  await page.getByRole('button', { name: 'Edit description' }).click()
  await expect(descriptionEditor(page)).toHaveValue(
    `First body with a **bold** word and a bead ref: ${seed.betaId}`,
  )
  await descriptionEditor(page).fill('Second body.')
  await page.keyboard.press(SAVE_KEY)
  await expect(page.getByTestId('description-display')).toContainText(
    'Second body.',
  )
  expect(await bdShow(seed.gammaId)).toHaveProperty('description', 'Second body.')

  // Clear it: emptying the draft writes an empty description, which bd honours. The add
  // affordance coming back is the proof the field is actually gone, not just blank on screen.
  await page.getByTestId('description-display').click()
  await descriptionEditor(page).fill('')
  await page.keyboard.press(SAVE_KEY)
  await expect(page.getByTestId('description-add')).toBeVisible()
  const cleared = await bdShow(seed.gammaId)
  expect(cleared.description ?? '').toBe('')
})

test('Escape abandons a description edit without writing', async ({ page }) => {
  await page.goto(`/issues/${seed.alphaId}`)
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()

  await expect(async () => {
    await page.getByTestId('description-display').click()
    await expect(descriptionEditor(page)).toBeVisible({ timeout: 5000 })
  }).toPass()

  await descriptionEditor(page).fill('this must never reach bd')
  await page.keyboard.press('Escape')

  await expect(page.getByTestId('description-editor')).toBeHidden()
  await expect(page.getByTestId('description-display')).toContainText(
    'first seeded child',
  )
  // The seed is untouched.
  expect(await bdShow(seed.alphaId)).toHaveProperty(
    'description',
    'first seeded child',
  )
})

test('renames an issue from the title and reflects it on the list', async ({
  page,
}) => {
  await page.goto(`/issues/${seed.gammaId}`)
  await expect(page.getByRole('heading', { name: 'Gamma chore' })).toBeVisible()

  await expect(async () => {
    await page.getByTestId('issue-title').click()
    await expect(page.getByLabel('Issue title')).toBeVisible({ timeout: 5000 })
  }).toPass()

  await page.getByLabel('Issue title').fill('Gamma chore renamed')
  await page.getByLabel('Issue title').press('Enter')

  // Wait on the read-only heading, not the h1: while the editor is open the h1's accessible
  // name is the input's draft, so `heading { name }` matches the typed text before the write
  // has been sent. The editor only closes once the save resolved, which is the point bd is
  // guaranteed to have the new title.
  await expect(page.getByTestId('issue-title')).toHaveText('Gamma chore renamed')
  expect(await bdShow(seed.gammaId)).toHaveProperty('title', 'Gamma chore renamed')

  // The invalidated list carries the new name.
  await page.goto('/issues')
  await expect(page.getByText('Gamma chore renamed')).toBeVisible()

  // Restore the seed title for downstream specs.
  await page.goto(`/issues/${seed.gammaId}`)
  await expect(async () => {
    await page.getByTestId('issue-title').click()
    await expect(page.getByLabel('Issue title')).toBeVisible({ timeout: 5000 })
  }).toPass()
  await page.getByLabel('Issue title').fill('Gamma chore')
  await page.getByLabel('Issue title').press('Enter')
  await expect(page.getByTestId('issue-title')).toHaveText('Gamma chore')
  expect(await bdShow(seed.gammaId)).toHaveProperty('title', 'Gamma chore')
})

test('Escape abandons a title edit, and a blank title is refused', async ({
  page,
}) => {
  await page.goto(`/issues/${seed.gammaId}`)
  await expect(page.getByRole('heading', { name: 'Gamma chore' })).toBeVisible()

  await expect(async () => {
    await page.getByTestId('issue-title').click()
    await expect(page.getByLabel('Issue title')).toBeVisible({ timeout: 5000 })
  }).toPass()

  // A blank title is refused outright: the editor stays open rather than writing an empty name.
  await page.getByLabel('Issue title').fill('')
  await page.getByLabel('Issue title').press('Enter')
  await expect(page.getByLabel('Issue title')).toBeVisible()

  await page.getByLabel('Issue title').fill('discard me')
  await page.getByLabel('Issue title').press('Escape')

  // Exact text, not `heading { name }`: that matcher is a substring match, so it would also
  // accept a title this spec proves was never written.
  await expect(page.getByTestId('issue-title')).toHaveText('Gamma chore')
  expect(await bdShow(seed.gammaId)).toHaveProperty('title', 'Gamma chore')
})

test('adds an optional section from the add menu and bd stores it', async ({
  page,
}) => {
  await page.goto(`/issues/${seed.gammaId}`)
  await expect(page.getByRole('heading', { name: 'Gamma chore' })).toBeVisible()

  // Hydration guard, as above: the menu is SSR-rendered before React attaches.
  await expect(async () => {
    await page.getByTestId('add-section').click()
    await expect(
      page.getByRole('menuitem', { name: 'Acceptance criteria' }),
    ).toBeVisible({ timeout: 5000 })
  }).toPass()

  await page.getByRole('menuitem', { name: 'Acceptance criteria' }).click()

  const editor = page.getByLabel('Acceptance criteria', { exact: true })
  await expect(editor).toBeVisible()
  await editor.fill('- [ ] the section round-trips through bd')
  await editor.press(SAVE_KEY)

  await expect(page.getByTestId('acceptance_criteria-display')).toContainText(
    'the section round-trips through bd',
  )
  await expect(async () => {
    const issue = await bdShow(seed.gammaId)
    expect(issue.acceptance_criteria ?? '').toContain(
      'the section round-trips through bd',
    )
  }).toPass()

  // Now that it has content the menu must stop offering it.
  await page.getByTestId('add-section').click()
  await expect(
    page.getByRole('menuitem', { name: 'Acceptance criteria' }),
  ).toHaveCount(0)
})

// pm-beads-6d5: a save replaces the whole field, so a draft written over text an agent rewrote
// mid-edit erases it with no trace. The editor sends the text it opened with, and bd's own state
// is what decides — which is why this is an e2e rather than a component test.
test('refuses a description save that would erase a concurrent agent edit', async ({
  page,
}) => {
  // Gamma's description was cleared by the first spec in this file, so this starts on the add
  // affordance and every write below is this spec's own.
  await page.goto(`/issues/${seed.gammaId}`)
  await expect(page.getByRole('heading', { name: 'Gamma chore' })).toBeVisible()

  await expect(async () => {
    await page.getByTestId('description-add').click()
    await expect(descriptionEditor(page)).toBeVisible({ timeout: 5000 })
  }).toPass()
  await descriptionEditor(page).fill('The human was typing this.')

  // An agent writes the same field while the editor is open — the whole point of the bead.
  await runBd([
    'update',
    seed.gammaId,
    '--description',
    'The agent wrote this first.',
  ])

  await page.keyboard.press(SAVE_KEY)

  // Refused, and it says what it would have overwritten.
  const notice = page.getByTestId('description-conflict')
  await expect(notice).toBeVisible()
  await expect(notice).toContainText('The agent wrote this first.')
  // The draft is still there to save or merge by hand.
  await expect(descriptionEditor(page)).toHaveValue('The human was typing this.')
  // And bd still holds the agent's text: nothing was clobbered.
  expect(await bdShow(seed.gammaId)).toHaveProperty(
    'description',
    'The agent wrote this first.',
  )

  // Overwriting is a deliberate press, and only then does the draft land.
  await page.getByRole('button', { name: /Overwrite with my version/ }).click()
  await expect(page.getByTestId('description-editor')).toBeHidden()
  await expect(page.getByTestId('description-display')).toContainText(
    'The human was typing this.',
  )
  expect(await bdShow(seed.gammaId)).toHaveProperty(
    'description',
    'The human was typing this.',
  )

  // Leave the seed as this file found it.
  await runBd(['update', seed.gammaId, '--description', ''])
})
