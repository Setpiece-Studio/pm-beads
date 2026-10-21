// ABOUTME: The merged-PR sweep's interval poll — decides which projects it covers, refuses to
// ABOUTME: run in test harnesses, and guarantees two sweeps never overlap.

import { homedir } from 'node:os'
import { beadsProjectDir } from './cli'
import { sweepMergedPrs } from './pr-sweep-run'
import { readSweepConfig, type SweepSidecarConfig } from './pr-sweep-store'
import { discoverProjects, parseScanDirs } from './projects'

/** How often the server sweeps. Merges are not urgent — this exists so a bead closes on its
 * own within a coffee break, not so the UI is live. The manual toolbar action is the fast path. */
export const SWEEP_POLL_INTERVAL_MS = 5 * 60_000

type PollEnv = Record<string, string | undefined>

/**
 * Whether this process should poll at all.
 *
 * Off in test harnesses by default: a sweep WRITES to beads, and neither a vitest run nor an
 * e2e run should have a background timer closing issues under the test that is asserting on
 * them. `PM_BEADS_SWEEP_POLL` overrides in both directions — `1` to exercise the poll on
 * purpose, `0` to silence it on a machine where it is not wanted.
 */
export function sweepPollAllowed(env: PollEnv = process.env): boolean {
  const override = env.PM_BEADS_SWEEP_POLL?.trim()
  if (override === '1') return true
  if (override === '0') return false
  return env.VITEST === undefined && env.PM_BEADS_E2E === undefined
}

/** Whether the poll covers one project: the env-default project is in by default, any other
 * project needs `sweep.enabled: true`, and `sweep.enabled: false` opts out either way. */
export function shouldPollProject(
  config: SweepSidecarConfig,
  isDefault: boolean,
): boolean {
  if (config.enabled !== undefined) return config.enabled
  return isDefault
}

/** The project dirs this tick should sweep: the env default plus every discovered project
 * whose sidecar opted in. Re-derived each tick so a sidecar edit takes effect without a
 * restart, and so a project that disappears simply stops being swept. */
export function sweepPollTargets(): string[] {
  const projects = discoverProjects(
    parseScanDirs(process.env.PM_BEADS_SCAN_DIRS, homedir()),
    beadsProjectDir(),
  )
  return projects
    .filter((project) =>
      shouldPollProject(readSweepConfig(project.path), project.isDefault),
    )
    .map((project) => project.path)
}

/** Return value is ignored — the poll is fire-and-forget; the summary panel is where a
 * SweepResult is actually read. */
type SweepRunner = (projectDir: string) => Promise<unknown>

// One poll at a time, process-wide. bd calls are already serialized by the cli.ts mutex, but a
// slow gh could otherwise let tick N+1 start while tick N is still applying tick N's plan, and
// the two would race to stamp lastRunAt.
let polling = false

/**
 * Sweep every target once. Never throws and never overlaps: a tick that arrives while the
 * previous one is still running is dropped, and a project that fails logs a warning so the
 * remaining projects are still swept.
 */
export async function sweepPollOnce(
  targets: readonly string[] = sweepPollTargets(),
  sweep: SweepRunner = (projectDir) => sweepMergedPrs({ projectDir }),
): Promise<void> {
  if (polling) return
  polling = true
  try {
    for (const projectDir of targets) {
      try {
        await sweep(projectDir)
      } catch (error) {
        console.warn(
          `[pm-beads] merged-PR sweep failed for ${projectDir}: ${message(error)}`,
        )
      }
    }
  } finally {
    polling = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/**
 * Start the interval poll. Returns true when it actually started — false when the environment
 * forbids it or a timer is already running, so a double import cannot schedule two.
 *
 * The first sweep is one interval away, not immediate: server boot is exactly when a person is
 * about to look at the UI, and a write storm is not what they want to land on.
 */
export function startSweepScheduler(): boolean {
  if (timer !== null) return false
  if (!sweepPollAllowed()) return false
  timer = setInterval(() => {
    void sweepPollOnce()
  }, SWEEP_POLL_INTERVAL_MS)
  // The poll must never be the reason the server process stays alive.
  timer.unref?.()
  return true
}

export function stopSweepScheduler(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
