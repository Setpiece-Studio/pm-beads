// ABOUTME: Pure predicate deriving "has an unresolved blocker" from bd list's embedded dependency
// ABOUTME: edge records — a blocks edge to a non-closed issue present in the loaded set. No bd call.

import type { Issue } from './types'

/** Map every loaded issue's id to its status, the lookup the predicate resolves blockers against. */
export function buildStatusMap(issues: Issue[]): Map<string, string> {
  const statusById = new Map<string, string>()
  for (const issue of issues) statusById.set(issue.id, issue.status)
  return statusById
}

/**
 * True iff `issue` has a `blocks` dependency edge whose blocker (`depends_on_id`) is present in
 * `statusById` and maps to a non-`closed` status. A blocker absent from the map (cross-project /
 * external) is treated as NOT blocking — conservative, we only flag confirmable local blockers
 * (R11). This is about the edges, independent of `issue`'s own literal `blocked` status.
 */
export function hasUnresolvedBlocker(
  issue: Issue,
  statusById: Map<string, string>,
): boolean {
  for (const edge of issue.dependencies ?? []) {
    if (edge.type !== 'blocks') continue
    const blockerStatus = statusById.get(edge.depends_on_id)
    if (blockerStatus !== undefined && blockerStatus !== 'closed') return true
  }
  return false
}

/** Set of ids in `issues` that have an unresolved blocker — one status map, one pass. */
export function buildBlockedIds(issues: Issue[]): Set<string> {
  const statusById = buildStatusMap(issues)
  const ids = new Set<string>()
  for (const issue of issues) {
    if (hasUnresolvedBlocker(issue, statusById)) ids.add(issue.id)
  }
  return ids
}
