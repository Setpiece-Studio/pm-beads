// ABOUTME: Pure logic for the issue detail's sub-issues section — row ordering, completion
// ABOUTME: counts, the show/hide-completed filter, and merging locally created children.

import type { Issue } from '@/lib/beads/types'

/**
 * The fields a sub-issue row needs. Structurally satisfied by both bd list's `Issue` (the
 * loader's children) and bd show's `ShowIssue` (what createSubIssue hands back), so the
 * section can merge the two without converting between them.
 */
export type SubIssue = Pick<
  Issue,
  'id' | 'title' | 'status' | 'priority' | 'issue_type' | 'assignee'
>

/** Closed/total counts for the header's progress ring. */
export interface SubIssueProgress {
  closed: number
  total: number
}

export function subIssueProgress(
  issues: readonly SubIssue[],
): SubIssueProgress {
  return {
    closed: issues.filter(isClosed).length,
    total: issues.length,
  }
}

/**
 * Row order: open work before finished work, then priority (P0 first), then id. The
 * open-before-closed split is the point — a long-lived parent accumulates closed children
 * that would otherwise interleave with the work still to do. Every tiebreak is total, so
 * the order is deterministic across renders.
 */
export function orderSubIssues(issues: readonly SubIssue[]): SubIssue[] {
  return [...issues].sort(
    (a, b) =>
      Number(isClosed(a)) - Number(isClosed(b)) ||
      a.priority - b.priority ||
      a.id.localeCompare(b.id),
  )
}

/** Apply the header menu's "Show completed" toggle. */
export function filterSubIssues(
  issues: readonly SubIssue[],
  showCompleted: boolean,
): SubIssue[] {
  return showCompleted
    ? [...issues]
    : issues.filter((issue) => !isClosed(issue))
}

/**
 * Merge just-created children into the loader's list, deduped by id with the loader's copy
 * winning. The composer renders its result immediately; once the route's loader catches up
 * and includes the same child, the dedup keeps the row from doubling.
 */
export function mergeSubIssues(
  loaded: readonly SubIssue[],
  created: readonly SubIssue[],
): SubIssue[] {
  const byId = new Map<string, SubIssue>()
  for (const issue of created) byId.set(issue.id, issue)
  for (const issue of loaded) byId.set(issue.id, issue)
  return [...byId.values()]
}

function isClosed(issue: SubIssue): boolean {
  return issue.status === 'closed'
}
