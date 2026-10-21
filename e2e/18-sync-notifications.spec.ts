// ABOUTME: Browser sync notifications require opt-in and deduplicate repeated failures.
import { expect, test } from '@playwright/test'

test('sync alerts require opt-in, notify once, and open Settings', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { alerts: Notification[]; permissionRequests: number }
    state.alerts = []
    state.permissionRequests = 0
    class BrowserNotification {
      static permission = 'default'
      static async requestPermission() {
        state.permissionRequests++
        BrowserNotification.permission = 'granted'
        return 'granted'
      }
      onclick: (() => void) | null = null
      constructor(public title: string, public options: NotificationOptions) {
        state.alerts.push(this as unknown as Notification)
      }
      close() {}
    }
    Object.defineProperty(window, 'Notification', { value: BrowserNotification })
  })
  await page.route('**/api/sync*', (route) => route.fulfill({ json: { config: { enabled: true }, error: 'offline', conflicts: [] } }))
  await page.goto('/settings')
  await expect(page.getByRole('button', { name: 'Enable sync notifications' })).toBeEnabled()
  expect(await page.evaluate(() => (window as unknown as { permissionRequests: number }).permissionRequests)).toBe(0)
  await page.getByRole('button', { name: 'Enable sync notifications' }).click()
  await expect(page.getByRole('button', { name: 'Disable sync notifications' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as unknown as { alerts: unknown[] }).alerts.length)).toBe(1)
  const polled = page.waitForResponse((response) => response.url().includes('/api/sync'))
  await page.evaluate(() => window.dispatchEvent(new Event('pm-beads:sync-alerts')))
  await polled
  expect(await page.evaluate(() => (window as unknown as { alerts: unknown[] }).alerts.length)).toBe(1)
  await page.getByRole('link', { name: 'Issues', exact: true }).click()
  await page.evaluate(() => (window as unknown as { alerts: { onclick: () => void }[] }).alerts[0].onclick())
  await expect(page).toHaveURL(/\/settings$/)
})
