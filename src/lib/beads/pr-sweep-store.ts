// ABOUTME: The sweep's half of the .beads/pm-beads.json sidecar — reads sweep.enabled and
// ABOUTME: sweep.lastRunAt leniently, and records a run without disturbing the env block.

import { z } from 'zod'
import { readSidecarObject, updateSidecar } from './sidecar'

/** The sidecar's `sweep` block. Both keys optional — a project with no block at all is the
 * common case, and means "poll it only if it is the env-default project". */
export interface SweepSidecarConfig {
  /** true opts a non-default project into the interval poll; false disables it entirely. */
  enabled?: boolean
  /** ISO instant of the last sweep that finished with no warnings. The next run searches from
   * here minus the safety margin (pr-sweep.ts). */
  lastRunAt?: string
}

// Each key is validated on its own so one hand-edited value of the wrong type costs that key,
// not the whole block — the same leniency views-store applies to individual saved views.
const sweepBlockSchema = z.object({
  enabled: z.boolean().optional().catch(undefined),
  lastRunAt: z.string().min(1).optional().catch(undefined),
})

/** The project's sweep configuration. Never throws: a missing, unreadable, or malformed
 * sidecar reads as an empty block, exactly like an absent one. */
export function readSweepConfig(projectDir: string): SweepSidecarConfig {
  const sidecar = readSidecarObject(projectDir)
  if (sidecar === null) return {}
  const parsed = sweepBlockSchema.safeParse(sidecar.sweep)
  if (!parsed.success) return {}
  const config: SweepSidecarConfig = {}
  if (parsed.data.enabled !== undefined) config.enabled = parsed.data.enabled
  if (parsed.data.lastRunAt !== undefined)
    config.lastRunAt = parsed.data.lastRunAt
  return config
}

/**
 * Stamp `sweep.lastRunAt` for the project, leaving every other key — `env` above all — as it
 * was. Rejects rather than rewriting a sidecar that does not parse (sidecar.ts).
 *
 * Writing it bumps the sidecar's mtime, which invalidates the project's cached bd environment
 * (project-env.ts keys its cache on that mtime). That costs one `mise env --json` on the next
 * bd call — a few tens of milliseconds, once per sweep.
 */
export function recordSweepRun(
  projectDir: string,
  ranAt: string,
): Promise<void> {
  return updateSidecar(projectDir, (sidecar) => {
    const existing = sweepBlockSchema.safeParse(sidecar.sweep)
    sidecar.sweep = {
      ...(existing.success && existing.data.enabled !== undefined
        ? { enabled: existing.data.enabled }
        : {}),
      lastRunAt: ranAt,
    }
  })
}
