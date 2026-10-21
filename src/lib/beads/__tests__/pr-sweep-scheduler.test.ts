// ABOUTME: Unit tests for the sweep's interval poll — which environments it refuses to run in,
// ABOUTME: which projects it covers, and the guard that keeps two runs from overlapping.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  shouldPollProject,
  startSweepScheduler,
  stopSweepScheduler,
  sweepPollAllowed,
  sweepPollOnce,
} from '../pr-sweep-scheduler'

afterEach(() => {
  stopSweepScheduler()
})

describe('sweepPollAllowed', () => {
  it('is off under vitest and under the e2e harness', () => {
    expect(sweepPollAllowed({ VITEST: 'true' })).toBe(false)
    expect(sweepPollAllowed({ PM_BEADS_E2E: '1' })).toBe(false)
  })

  it('is on in an ordinary dev server', () => {
    expect(sweepPollAllowed({})).toBe(true)
  })

  it('lets PM_BEADS_SWEEP_POLL decide either way, test harness or not', () => {
    expect(sweepPollAllowed({ VITEST: 'true', PM_BEADS_SWEEP_POLL: '1' })).toBe(
      true,
    )
    expect(sweepPollAllowed({ PM_BEADS_SWEEP_POLL: '0' })).toBe(false)
  })
})

describe('shouldPollProject', () => {
  it('covers the env-default project by default', () => {
    expect(shouldPollProject({}, true)).toBe(true)
  })

  it('leaves other projects alone unless their sidecar opts in', () => {
    expect(shouldPollProject({}, false)).toBe(false)
    expect(shouldPollProject({ enabled: true }, false)).toBe(true)
  })

  it('lets sweep.enabled: false disable a project entirely, default or not', () => {
    expect(shouldPollProject({ enabled: false }, true)).toBe(false)
    expect(shouldPollProject({ enabled: false }, false)).toBe(false)
  })
})

describe('sweepPollOnce', () => {
  it('sweeps every target in turn', async () => {
    const swept: string[] = []
    await sweepPollOnce(['/a', '/b'], async (dir) => {
      swept.push(dir)
    })
    expect(swept).toEqual(['/a', '/b'])
  })

  it('carries on when one project fails', async () => {
    const swept: string[] = []
    await sweepPollOnce(['/a', '/b'], async (dir) => {
      if (dir === '/a') throw new Error('bd is wedged')
      swept.push(dir)
    })
    expect(swept).toEqual(['/b'])
  })

  it('refuses to start a second run while one is in flight', async () => {
    let release: () => void = () => {}
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    let runs = 0
    const sweep = async () => {
      runs += 1
      await blocked
    }

    const first = sweepPollOnce(['/a'], sweep)
    // Same tick, before the first has settled: the guard must drop this one.
    await sweepPollOnce(['/a'], sweep)
    expect(runs).toBe(1)

    release()
    await first
    // Once the first has finished, the next poll runs normally.
    await sweepPollOnce(['/a'], sweep)
    expect(runs).toBe(2)
  })
})

describe('startSweepScheduler', () => {
  it('does not start under vitest', () => {
    expect(startSweepScheduler()).toBe(false)
  })

  it('starts once when explicitly enabled, and stopping is idempotent', () => {
    vi.stubEnv('PM_BEADS_SWEEP_POLL', '1')
    try {
      expect(startSweepScheduler()).toBe(true)
      // Already running: a second call must not add a second timer.
      expect(startSweepScheduler()).toBe(false)
    } finally {
      stopSweepScheduler()
      stopSweepScheduler()
      vi.unstubAllEnvs()
    }
  })
})
