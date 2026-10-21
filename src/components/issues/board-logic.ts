// ABOUTME: Pure logic for the board view — view-mode URL serialization, drag enablement
// ABOUTME: per grouping, drop-to-status resolution, and which fields a card shows.

import type { Issue } from '@/lib/beads/types'
import type { DisplayProperty, GroupingKey } from './grouping'

export type ViewMode = 'list' | 'board'

/** Serialize the view mode for the URL: undefined at the list default. */
export function serializeViewMode(view: ViewMode): 'board' | undefined {
  return view === 'board' ? 'board' : undefined
}

/** Cards only move between columns when columns are statuses. */
export function dragEnabled(grouping: GroupingKey): boolean {
  return grouping === 'status'
}

// Board columns read as a left→right pipeline (backlog → done), unlike the list's
// triage order which surfaces in-progress work first.
export const BOARD_STATUS_ORDER = [
  'deferred',
  'open',
  'in_progress',
  'blocked',
  'closed',
] as const

/**
 * Order status columns by workflow progression; unknown statuses keep their
 * incoming order after the known ones. Non-status groupings pass through.
 */
export function orderBoardGroups<T extends { key: string }>(
  groups: T[],
  grouping: GroupingKey,
  statusOrder: readonly string[] = BOARD_STATUS_ORDER,
): T[] {
  if (grouping !== 'status') return groups
  const rank = (key: string) => {
    const i = statusOrder.indexOf(key)
    return i === -1 ? statusOrder.length : i
  }
  return [...groups].sort((a, b) => rank(a.key) - rank(b.key))
}

/**
 * Resolve a drop onto a status column to the status to write, or null when the
 * card landed back on its own column (no-op).
 */
export function statusAfterDrop(
  issue: Issue,
  columnKey: string,
): string | null {
  return issue.status === columnKey ? null : columnKey
}

/** Card metadata visibility; ID and status are always shown and not listed here. */
export interface BoardCardProperties {
  priority: boolean
  labels: boolean
  project: boolean
}

export function boardCardProperties(
  displayProperties: ReadonlySet<DisplayProperty>,
): BoardCardProperties {
  return {
    priority: displayProperties.has('priority'),
    labels: displayProperties.has('labels'),
    project: displayProperties.has('project'),
  }
}
