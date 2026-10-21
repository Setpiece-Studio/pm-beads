// ABOUTME: Detects bd's "missing issue" failures so the detail route loaders can map them to a
// ABOUTME: route notFound() instead of the generic error component. Pure — no router dependency.

/**
 * True iff `error` is a bd "issue does not exist" failure. A missing id surfaces either as
 * getIssue's own "Issue not found: <id>" (empty bd output) or as bd's non-zero "no issue found
 * matching" exit; both should render a detail route's notFoundComponent. Callers keep the
 * route-specific `throw notFound({ routeId })` so the wording stays per-route exact.
 */
export function isIssueNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Issue not found') || message.includes('no issue found')
  )
}

export function isMemoryNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Memory not found')
}
