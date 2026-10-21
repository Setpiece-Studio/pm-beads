// ABOUTME: Guards the dev-server boundary between source files and mutable Beads runtime data.
// ABOUTME: A bd write must not trigger a Vite refresh that discards in-progress UI drafts.

import { describe, expect, it } from 'vitest'
import config, { BEADS_RUNTIME_WATCH_GLOB } from '../../vite.config'

describe('Vite development watcher', () => {
  it('ignores Beads runtime data in every project', () => {
    expect(config.server?.watch).toMatchObject({
      ignored: [BEADS_RUNTIME_WATCH_GLOB],
    })
    expect(BEADS_RUNTIME_WATCH_GLOB).toBe('**/.beads/**')
  })
})
