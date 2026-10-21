// ABOUTME: Alerts respect permission/opt-in, deduplicate failures, and rearm on recovery.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  notifySyncIssue,
  setSyncAlerts,
  syncAlertProjects,
} from './sync-notifications'

const create = vi.fn()
beforeEach(() => {
  localStorage.clear()
  create.mockClear()
  class MockNotification {
    static permission = 'granted'
    constructor(title: string, options: unknown) {
      create(title, options)
    }
    close() {}
  }
  vi.stubGlobal('Notification', MockNotification)
})
afterEach(() => vi.unstubAllGlobals())
it('requires both workspace opt-in and browser permission', () => {
  notifySyncIssue('/one', { error: 'offline' })
  expect(create).not.toHaveBeenCalled()
  setSyncAlerts('/one', true)
  Object.defineProperty(Notification, 'permission', { value: 'denied' })
  notifySyncIssue('/one', { error: 'offline' })
  expect(create).not.toHaveBeenCalled()
})
it('deduplicates failures, alerts on changed conflicts, and rearms after recovery', () => {
  setSyncAlerts('/one', true)
  notifySyncIssue('/one', { error: 'offline' })
  notifySyncIssue('/one', { error: 'offline' })
  expect(create).toHaveBeenCalledTimes(1)
  notifySyncIssue('/one', { conflicts: [{ token: 'a' }] })
  expect(create).toHaveBeenCalledTimes(2)
  expect(create).toHaveBeenLastCalledWith(
    'Sync needs attention · one',
    expect.objectContaining({
      body: '1 unresolved conflict. Open Settings to resolve.',
    }),
  )
  notifySyncIssue('/one', {})
  notifySyncIssue('/one', { conflicts: [{ token: 'a' }] })
  expect(create).toHaveBeenCalledTimes(3)
})
it('keeps workspace preferences independent and allows disabling', () => {
  setSyncAlerts('/one', true)
  setSyncAlerts('/two', true)
  setSyncAlerts('/one', false)
  expect(syncAlertProjects()).toEqual(['/two'])
  notifySyncIssue('/one', { error: 'offline' })
  notifySyncIssue('/two', { error: 'offline' })
  expect(create).toHaveBeenCalledTimes(1)
})
it('tolerates unsupported notifications and corrupt browser preferences', () => {
  localStorage.setItem('pm-beads:sync-alert-projects', '{')
  expect(syncAlertProjects()).toEqual([])
  setSyncAlerts('', true)
  vi.stubGlobal('Notification', undefined)
  expect(() => notifySyncIssue('', { error: 'offline' })).not.toThrow()
})
