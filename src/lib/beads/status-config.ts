// ABOUTME: Reads the selected project's observed/configured statuses and pm-beads icon config.
// ABOUTME: All bd reads use the shared CLI mutex; malformed or missing config falls back safely.

import { getCachedCustomStatuses } from './cache'
import { type BdOptions, beadsProjectDir } from './cli'
import { listIssues } from './queries'
import { readSidecarObject } from './sidecar'
import { buildStatusPipeline, type StatusPipeline } from './status-model'

export async function readStatusPipeline(
  opts: BdOptions = {},
): Promise<StatusPipeline> {
  const issues = await listIssues({ all: true }, opts)
  const configured = await getCachedCustomStatuses(opts)
  const sidecar = readSidecarObject(opts.cwd ?? beadsProjectDir())
  return buildStatusPipeline({
    observed: issues.map((issue) => issue.status),
    configured,
    block: sidecar?.statuses,
  })
}
