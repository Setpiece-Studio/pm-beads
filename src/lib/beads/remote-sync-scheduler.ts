// ABOUTME: Five-minute server poll; every project must explicitly opt in.
import { homedir } from 'node:os'
import { beadsProjectDir } from './cli'
import { discoverProjects, parseScanDirs } from './projects'
import { readSyncConfig, syncProject } from './remote-sync'

// Vite reloads server modules; keep one timer and one poll guard across those reloads.
const runtime = globalThis as typeof globalThis & {
  __pmBeadsRemoteSync?: {
    timer?: ReturnType<typeof setInterval>
    polling: boolean
    tick: () => Promise<void>
  }
}
runtime.__pmBeadsRemoteSync ??= {
  polling: false,
  tick: async () => {},
}
const state = runtime.__pmBeadsRemoteSync
export async function pollRemoteSync() {
  if (state.polling) return
  state.polling = true
  try {
    for (const project of discoverProjects(
      parseScanDirs(process.env.PM_BEADS_SCAN_DIRS, homedir()),
      beadsProjectDir(),
    )) {
      try {
        if (readSyncConfig(project.path).enabled)
          await syncProject(project.path)
      } catch (error) {
        console.warn(
          `[pm-beads] sync unavailable for ${project.name}: ${String(error)}`,
        )
      }
    }
  } finally {
    state.polling = false
  }
}
export function startRemoteSyncScheduler() {
  state.tick = pollRemoteSync
  if (
    state.timer ||
    process.env.VITEST ||
    process.env.PM_BEADS_E2E ||
    process.env.PM_BEADS_SYNC_POLL === '0'
  )
    return
  state.timer = setInterval(() => {
    void state.tick()
  }, 300_000)
  state.timer.unref?.()
}
