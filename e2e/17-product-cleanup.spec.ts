// ABOUTME: Workspace creation and fresh agent checks plus Projects board/display URL round trips.
import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_PROJECT_DIR, readSeed, runBd, runBdJson } from './support/bd'

test('workspace composer persists fields and the check API immediately sees CLI writes', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000)
  await runBd(['config', 'set', 'types.custom', 'spike'])
  await runBd(['config', 'set', 'status.custom', 'qa'])
  await page.goto('/issues')
  await expect(async () => {
    await page.getByRole('button', { name: 'Create issue', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3000 })
  }).toPass()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('Composer verification')
  await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('Created from the sidebar')
  await dialog.getByLabel('Type', { exact: true }).fill('spike')
  await dialog.getByLabel('Status', { exact: true }).fill('qa')
  await dialog.getByLabel('Priority', { exact: true }).fill('1')
  await dialog.getByText('More properties', { exact: true }).click()
  await dialog.getByLabel('Assignee', { exact: true }).fill('test-agent')
  await dialog.getByLabel('Labels (comma separated)').fill('composer,verified')
  await dialog.getByLabel('Parent', { exact: true }).fill(readSeed().epicId)
  await dialog.getByLabel('Blocked by (comma separated IDs)').fill(readSeed().alphaId)
  await dialog.getByLabel('Pull request', { exact: true }).fill('https://github.com/example/repo/pull/1')
  for (const label of ['Design', 'Acceptance criteria', 'Notes']) await dialog.getByRole('textbox', { name: label, exact: true }).fill(`${label} content`)
  await page.screenshot({ path: testInfo.outputPath('workspace-composer.png') })
  await dialog.getByRole('button', { name: 'Create issue', exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  const rows = await runBdJson(['list', '--all', '--limit', '0', '--json']) as { id: string; title: string }[]
  const created = rows.find(row => row.title === 'Composer verification')!
  expect(created.id).not.toContain('.')
  const details = await runBdJson(['show', created.id, '--json']) as Record<string, unknown>[]
  expect(details[0]).toMatchObject({ issue_type: 'spike', status: 'qa', priority: 1, assignee: 'test-agent', description: 'Created from the sidebar', design: 'Design content', acceptance_criteria: 'Acceptance criteria content', notes: 'Notes content', labels: ['composer', 'verified'], metadata: { pr_url: 'https://github.com/example/repo/pull/1' } })
  await runBd(['close', created.id, '--force'])
  await runBd(['update', created.id, '--set-metadata', 'ask.invalid={'])
  const check = await request.get(`/api/check?issueId=${created.id}`)
  expect(check.status()).toBe(200)
  expect(await check.json()).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'ASK_JSON_INVALID', issueId: created.id })] })
  await runBd(['update', created.id, '--unset-metadata', 'ask.invalid'])
  expect(await (await request.get(`/api/check?issueId=${created.id}`)).json()).toMatchObject({ ok: true, issues: [] })
})

test('project board follows a custom pipeline and persists drag-to-status', async ({ page }, testInfo) => {
  const path = join(E2E_PROJECT_DIR, '.beads', 'pm-beads.json')
  let sidecar = {}
  try { sidecar = JSON.parse(readFileSync(path, 'utf8')) } catch { /* Fresh fixture has no sidecar. */ }
  writeFileSync(path, JSON.stringify({ ...sidecar, statuses: { pipeline: ['qa', 'open', 'in_progress', 'blocked', 'deferred', 'closed'] } }))
  await page.goto('/projects?view=board&display=id')
  await expect(page.locator('[data-board-column]').first()).toHaveAttribute('data-board-column', 'qa')
  await expect(async () => {
    await page.getByRole('button', { name: 'Display', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Created', exact: true })).toBeVisible({ timeout: 3000 })
  }).toPass()
  await page.keyboard.press('Escape')
  const card = page.locator('[data-board-column="open"]').getByRole('button', { name: /Lonely Epic/ })
  const target = page.locator('[data-board-column="qa"]')
  const from = await card.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('Board geometry unavailable')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2)
  await page.mouse.move(to.x + to.width / 2, to.y + 70, { steps: 12 })
  await page.mouse.up()
  await expect(target.getByRole('button', { name: /Lonely Epic/ })).toBeVisible()
  const details = await runBdJson(['show', readSeed().lonelyEpicId, '--json']) as { status: string }[]
  expect(details[0].status).toBe('qa')
  await page.screenshot({ path: testInfo.outputPath('projects-board.png') })
})

test('projects board and display options survive reload', async ({ page }) => {
  await page.goto('/projects?view=board&display=id,progress,child-count')
  await expect(page.locator('[data-board-column="open"]')).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp('Lonely Epic') })).toBeVisible()
  await expect(async () => {
    await page.getByRole('button', { name: 'Display', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Created', exact: true })).toBeVisible({ timeout: 3000 })
  }).toPass()
  await page.getByRole('button', { name: 'Created', exact: true }).click()
  await expect(page).toHaveURL(/display=.*created/)
  await page.reload()
  await expect(page.locator('[data-board-column="open"]')).toBeVisible()
})
