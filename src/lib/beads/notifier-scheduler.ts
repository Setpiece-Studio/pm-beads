// ABOUTME: Non-overlapping interval poll that rings configured tmux agent sessions.
// ABOUTME: Disabled in Vitest/e2e and discovers sidecar edits again on every tick.

import { homedir } from 'node:os'
import { beadsProjectDir } from './cli'
import { notifyProject } from './notifier'
import { readNotifierConfig } from './notifier-store'
import { discoverProjects, parseScanDirs } from './projects'

export const NOTIFIER_POLL_INTERVAL_MS = 10_000
type PollEnv = Record<string, string | undefined>

export function notifierPollAllowed(env: PollEnv = process.env): boolean {
  const override = env.PM_BEADS_NOTIFIER_POLL?.trim()
  if (override === '1') return true
  if (override === '0') return false
  return env.VITEST === undefined && env.PM_BEADS_E2E === undefined
}

export function notifierPollTargets(): string[] {
  return discoverProjects(
    parseScanDirs(process.env.PM_BEADS_SCAN_DIRS, homedir()),
    beadsProjectDir(),
  )
    .map((project) => project.path)
    .filter((projectDir) =>
      Object.values(readNotifierConfig(projectDir).personas).some(
        (persona) => persona.tmux !== undefined,
      ),
    )
}

type NotifyRunner = (projectDir: string) => Promise<unknown>
let polling = false

export async function notifierPollOnce(
  targets: readonly string[] = notifierPollTargets(),
  notify: NotifyRunner = notifyProject,
): Promise<void> {
  if (polling) return
  polling = true
  try {
    for (const projectDir of targets) {
      try {
        await notify(projectDir)
      } catch (error) {
        console.warn(
          `[pm-beads] notifier failed for ${projectDir}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
  } finally {
    polling = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

export function startNotifierScheduler(): boolean {
  if (timer !== null || !notifierPollAllowed()) return false
  timer = setInterval(() => void notifierPollOnce(), NOTIFIER_POLL_INTERVAL_MS)
  timer.unref?.()
  return true
}

export function stopNotifierScheduler(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}
