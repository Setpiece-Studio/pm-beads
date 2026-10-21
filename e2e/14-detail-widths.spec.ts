// ABOUTME: E2E specs for issue detail reading widths and its responsive property flow.
// ABOUTME: Guards against horizontal overflow and captures narrow, light, and dark screenshots.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { expect, type Page, test } from '@playwright/test'
import { readSeed } from './support/bd'

const seed = readSeed()

/** Screenshots of the detail and its rail land here — gitignored, and named in the PR. */
const SHOT_DIR = join(process.cwd(), 'test-results', 'detail-widths')

/** The rail holds titles now, so it has to be wide enough for one: 24rem, less nothing. */
const MIN_RAIL_WIDTH = 360

test.beforeAll(() => {
  mkdirSync(SHOT_DIR, { recursive: true })
})

/** Horizontal overflow of the document, in pixels. Zero or less is "does not scroll sideways". */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth - root.clientWidth
  })
}

test('the properties rail is wide enough for a bead title at 1280', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/issues/${seed.alphaId}`)
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()
  // Radix renders a Select's value on the client only, so wait for the rail to hydrate —
  // otherwise the measurement (and the screenshot) catches it mid-flight.
  await expect(page.getByLabel('Status')).toContainText('In Progress')

  const rail = page.getByRole('complementary', { name: 'Properties' })
  const box = await rail.boundingBox()
  if (!box) throw new Error('no properties rail')
  expect(box.width).toBeGreaterThanOrEqual(MIN_RAIL_WIDTH)

  // The body keeps its own measure beside the wider rail rather than pushing the page out.
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

  await page.screenshot({ path: join(SHOT_DIR, 'issue-detail-light.png') })
})

test('the detail still fits a 1024-wide window', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto(`/issues/${seed.alphaId}`)
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()
  // Radix renders a Select's value on the client only, so wait for the rail to hydrate —
  // otherwise the measurement (and the screenshot) catches it mid-flight.
  await expect(page.getByLabel('Status')).toContainText('In Progress')

  await expect(
    page.getByRole('complementary', { name: 'Properties' }),
  ).toBeVisible()
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
})

test('properties reflow when the issue pane, not the viewport, reaches 750px', async ({
  page,
}) => {
  // The persistent navigation leaves this 900px viewport with a detail pane below 750px.
  // A viewport media query would miss this state and keep the reading column cramped.
  await page.setViewportSize({ width: 900, height: 900 })
  await page.goto(`/issues/${seed.alphaId}`)

  const title = page.getByRole('heading', { name: 'Alpha task' })
  const properties = page.locator('[data-property-group]')
  const body = page.locator('[data-issue-body]')
  const status = page.getByLabel('Status')
  const priority = page.getByLabel('Priority')
  await expect(status).toContainText('In Progress')

  const titleBox = await title.boundingBox()
  const propertiesBox = await properties.boundingBox()
  const bodyBox = await body.boundingBox()
  const statusBox = await status.boundingBox()
  const priorityBox = await priority.boundingBox()
  if (!titleBox || !propertiesBox || !bodyBox || !statusBox || !priorityBox) {
    throw new Error('missing responsive issue-detail geometry')
  }

  expect(propertiesBox.y).toBeGreaterThan(titleBox.y + titleBox.height)
  expect(bodyBox.y).toBeGreaterThanOrEqual(
    propertiesBox.y + propertiesBox.height,
  )
  expect(Math.abs(statusBox.y - priorityBox.y)).toBeLessThanOrEqual(1)
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

  await page.screenshot({ path: join(SHOT_DIR, 'issue-detail-pane-750.png') })
})

test('the breadcrumb leads with the title and trails the id', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/issues/${seed.alphaId}`)

  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
  await expect(breadcrumb).toContainText(
    new RegExp(`Alpha task.*${seed.alphaId}`),
  )
})

test('the detail and its rail render in dark mode too', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'dark')
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/issues/${seed.alphaId}`)
  await expect(page.getByRole('heading', { name: 'Alpha task' })).toBeVisible()
  // Radix renders a Select's value on the client only, so wait for the rail to hydrate —
  // otherwise the measurement (and the screenshot) catches it mid-flight.
  await expect(page.getByLabel('Status')).toContainText('In Progress')

  await page.screenshot({ path: join(SHOT_DIR, 'issue-detail-dark.png') })
})
