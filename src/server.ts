// ABOUTME: TanStack Start server entry — the framework's default request handler, plus the one
// ABOUTME: piece of app state that has to live in the server process: the merged-PR sweep poll.

import {
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { handleCheck } from './lib/beads/check'
import { beadsProjectDir } from './lib/beads/cli'
import { startNotifierScheduler } from './lib/beads/notifier-scheduler'
import { startSweepScheduler } from './lib/beads/pr-sweep-scheduler'
import { bdOptionsFor } from './lib/beads/projects'
import { readSyncConfig, readSyncStatus } from './lib/beads/remote-sync'
import { startRemoteSyncScheduler } from './lib/beads/remote-sync-scheduler'

// This module exists ONLY so the interval poll has a server-only home. A top-level call in
// server-fns.ts would sit in the client graph too and drag node:child_process into the browser
// bundle; the server entry never reaches the client. The scheduler declines to start under
// vitest and the e2e harness, and returns false rather than doubling up if it is already running.
startSweepScheduler()
startNotifierScheduler()
startRemoteSyncScheduler()

const handler = createStartHandler(defaultStreamHandler)
export default {
  fetch: (request: Request) => {
    if (new URL(request.url).pathname === '/api/sync') {
      if (request.method !== 'GET')
        return new Response('Method not allowed', { status: 405 })
      const project =
        new URL(request.url).searchParams.get('project') ?? undefined
      try {
        const dir = bdOptionsFor(project).cwd ?? beadsProjectDir()
        return Response.json(
          {
            version: 1,
            config: readSyncConfig(dir),
            ...readSyncStatus(dir),
            source: 'cached',
          },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 503 })
      }
    }
    if (new URL(request.url).pathname === '/api/check') {
      if (request.method !== 'GET')
        return new Response('Method not allowed', {
          status: 405,
          headers: { Allow: 'GET' },
        })
      return handleCheck(request)
    }
    return handler(request)
  },
}
