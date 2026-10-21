// ABOUTME: E2E specs for the issues table's column widths — the title column absorbs the
// ABOUTME: slack instead of the labels column, and the label stack expands on hover.

import { expect, test } from '@playwright/test'
import {
  E2E_WIDE_PROJECT_DIR,
  WIDE_EPIC_NAME,
  WIDE_LABELS,
  WIDE_TITLE,
} from './support/bd'

// The wide project's single issue carries a long title, four labels, and a long epic name.
const WIDE_URL = `/issues?project=${encodeURIComponent(E2E_WIDE_PROJECT_DIR)}`

test.use({ viewport: { width: 1280, height: 900 } })

test('the title column takes the leftover width, not the labels column', async ({
  page,
}) => {
  await page.goto(WIDE_URL)
  const titleCell = page.locator('td[data-column="title"]')
  await expect(titleCell).toBeVisible()

  const titleBox = await titleCell.boundingBox()
  const labelsBox = await page
    .locator('td[data-column="labels"]')
    .boundingBox()
  const projectBox = await page
    .locator('td[data-column="project"]')
    .boundingBox()
  if (!titleBox || !labelsBox || !projectBox) throw new Error('missing cells')

  expect(titleBox.width).toBeGreaterThan(labelsBox.width)
  expect(titleBox.width).toBeGreaterThan(projectBox.width)

  // The project chip truncates at its cap instead of growing to fit the long epic name.
  const chip = page.getByText(WIDE_EPIC_NAME, { exact: true })
  await expect(chip).toBeVisible()
  const chipWidth = await chip.evaluate(
    (element) => element.getBoundingClientRect().width,
  )
  expect(chipWidth).toBeLessThanOrEqual(12 * 16)
})

test('the title renders at least forty characters before truncating', async ({
  page,
}) => {
  await page.goto(WIDE_URL)
  const titleCell = page.locator('td[data-column="title"]')
  await expect(titleCell).toBeVisible()

  // Measure the first forty characters in the title's own font and compare against the
  // width the cell actually offers, so the assertion tracks the real rendered type.
  const fits = await titleCell.evaluate((cell, title: string) => {
    const span = cell.querySelector('span')
    if (!span) throw new Error('no title span')
    const style = window.getComputedStyle(span)
    const ruler = document.createElement('span')
    ruler.style.font = style.font
    ruler.style.letterSpacing = style.letterSpacing
    ruler.style.whiteSpace = 'pre'
    ruler.style.position = 'absolute'
    ruler.style.visibility = 'hidden'
    ruler.textContent = title.slice(0, 40)
    document.body.append(ruler)
    const rulerWidth = ruler.getBoundingClientRect().width
    ruler.remove()
    return { available: span.getBoundingClientRect().width, rulerWidth }
  }, WIDE_TITLE)

  expect(fits.available).toBeGreaterThanOrEqual(fits.rulerWidth)
})

test('the labels cell stacks its pills and expands them on hover', async ({
  page,
}) => {
  await page.goto(WIDE_URL)
  const stack = page.locator('[data-label-stack]')
  await expect(stack).toBeVisible()

  // Collapsed: the leading pill is named, the rest peek out as dots behind a +N chip.
  await expect(stack).toHaveAttribute('data-expanded', 'false')
  await expect(stack.getByText(WIDE_LABELS[0], { exact: true })).toBeVisible()
  await expect(stack.getByText(WIDE_LABELS[3], { exact: true })).toHaveCount(0)
  await expect(stack.getByText('+1', { exact: true })).toBeVisible()
  await expect(stack).toHaveAttribute('aria-label', `Labels: ${WIDE_LABELS.join(', ')}`)

  // Pointer hover is unreliable on the headless CI runner (the pointer lands but React never
  // sees a mouseenter), and a hover delivered before hydration never re-fires. Park the mouse,
  // hover, and if the stack still hasn't expanded, deliver the mouseover React's onMouseEnter
  // listens for — same handler, deterministic delivery. Bounded steps so toPass can retry.
  await page.mouse.move(0, 0)
  await expect(async () => {
    await stack.hover({ timeout: 2000 })
    const expanded = await stack.getAttribute('data-expanded')
    if (expanded !== 'true') await stack.dispatchEvent('mouseover')
    await expect(stack).toHaveAttribute('data-expanded', 'true', {
      timeout: 1500,
    })
  }).toPass()
  for (const label of WIDE_LABELS) {
    await expect(stack.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(stack.getByText('+1', { exact: true })).toHaveCount(0)
})

test('the issues table never scrolls horizontally', async ({ page }) => {
  await page.goto(WIDE_URL)
  await expect(page.locator('td[data-column="title"]')).toBeVisible()

  const overflow = await page.evaluate(() => {
    const container = document.querySelector('[data-slot="table-container"]')
    if (!container) throw new Error('no table container')
    return {
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
      documentOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    }
  })
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  expect(overflow.documentOverflow).toBeLessThanOrEqual(0)
})
