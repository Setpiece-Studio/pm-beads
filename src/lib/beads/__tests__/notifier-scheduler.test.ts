// ABOUTME: Tests notifier poll opt-outs, failure isolation, and the no-overlap guard.

import { describe, expect, it, vi } from 'vitest'
import { notifierPollAllowed, notifierPollOnce } from '../notifier-scheduler'

describe('notifierPollAllowed', () => {
  it('refuses test harnesses unless explicitly enabled', () => {
    expect(notifierPollAllowed({ VITEST: 'true' })).toBe(false)
    expect(notifierPollAllowed({ PM_BEADS_E2E: '1' })).toBe(false)
    expect(
      notifierPollAllowed({ VITEST: 'true', PM_BEADS_NOTIFIER_POLL: '1' }),
    ).toBe(true)
    expect(notifierPollAllowed({ PM_BEADS_NOTIFIER_POLL: '0' })).toBe(false)
  })
})

describe('notifierPollOnce', () => {
  it('continues after one project fails', async () => {
    const notify = vi.fn(async (dir: string) => {
      if (dir === '/a') throw new Error('no bd')
    })
    await notifierPollOnce(['/a', '/b'], notify)
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('drops an overlapping tick', async () => {
    let release: () => void = () => {}
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const notify = vi.fn(async () => blocked)
    const first = notifierPollOnce(['/a'], notify)
    await notifierPollOnce(['/a'], notify)
    expect(notify).toHaveBeenCalledOnce()
    release()
    await first
  })
})
