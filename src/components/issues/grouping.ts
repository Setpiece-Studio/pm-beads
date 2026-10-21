// ABOUTME: Pure logic for the issues view — filtering, ordering, and grouping issues into
// ABOUTME: Linear-style buckets (by status, project/epic, label, or none) with canonical orders.

import {
  type ActiveFilter,
  issueMatchesFilters,
} from '@/components/filters/filters'
import type { Issue } from '@/lib/beads/types'
import { STATUS_ORDER, statusLabel, statusRank } from '@/lib/issue-meta'

export type GroupingKey = 'status' | 'project' | 'label' | 'none'
export type OrderingKey = 'priority' | 'status' | 'updated'

// Display properties: toggleable row metadata columns, Linear's "Display properties".
// Title is always visible and intentionally not listed here.
export const DISPLAY_PROPERTIES = [
  'priority',
  'id',
  'status',
  'labels',
  'project',
  'created',
  'updated',
] as const

export type DisplayProperty = (typeof DISPLAY_PROPERTIES)[number]

export const DISPLAY_PROPERTY_LABELS: Record<DisplayProperty, string> = {
  priority: 'Priority',
  id: 'ID',
  status: 'Status',
  labels: 'Labels',
  project: 'Project',
  created: 'Created',
  updated: 'Updated',
}

// Defaults match Linear's stock issues view: everything on except Created.
export const DEFAULT_DISPLAY_PROPERTIES: ReadonlySet<DisplayProperty> = new Set(
  ['priority', 'id', 'status', 'labels', 'project', 'updated'],
)

/**
 * Parse the `display` URL param (comma-separated property names) into a set.
 * Missing/undefined param means defaults; unknown names are dropped.
 */
export function parseDisplayProperties(
  param: string | undefined,
): ReadonlySet<DisplayProperty> {
  if (param === undefined) return DEFAULT_DISPLAY_PROPERTIES
  const valid = param
    .split(',')
    .filter((p): p is DisplayProperty =>
      (DISPLAY_PROPERTIES as readonly string[]).includes(p),
    )
  return new Set(valid)
}

/**
 * Serialize a display-property set for the URL: undefined when it matches the
 * defaults (keeps URLs clean), otherwise a canonical comma-separated list.
 */
export function serializeDisplayProperties(
  properties: ReadonlySet<DisplayProperty>,
): string | undefined {
  if (
    properties.size === DEFAULT_DISPLAY_PROPERTIES.size &&
    [...properties].every((p) => DEFAULT_DISPLAY_PROPERTIES.has(p))
  ) {
    return undefined
  }
  return DISPLAY_PROPERTIES.filter((p) => properties.has(p)).join(',')
}

export function toggleDisplayProperty(
  properties: ReadonlySet<DisplayProperty>,
  property: DisplayProperty,
): ReadonlySet<DisplayProperty> {
  const next = new Set(properties)
  if (next.has(property)) next.delete(property)
  else next.add(property)
  return next
}

/** Active filters: at most one per property, ANDed together. */
export type IssueFilters = ActiveFilter[]

export interface IssueGroup {
  key: string
  label: string
  /** Set when grouping by status so the header can render the status icon. */
  status?: string
  issues: Issue[]
}

const NO_PROJECT_KEY = '__none__'
const NO_LABEL_KEY = '__none__'

// Epics are projects in this UI, not rows in the issues list. Closed issues only appear
// when grouping by status (Linear's Done group) or when a status filter explicitly
// governs visibility — once the user filters on status, the filter decides entirely.
export function filterIssues(
  issues: Issue[],
  filters: IssueFilters,
  grouping: GroupingKey,
): Issue[] {
  const hasStatusFilter = filters.some((f) => f.property === 'status')
  return issues.filter((issue) => {
    if (issue.issue_type === 'epic') return false
    if (!issueMatchesFilters(issue, filters)) return false
    if (issue.status === 'closed' && grouping !== 'status' && !hasStatusFilter)
      return false
    return true
  })
}

function updatedDesc(a: Issue, b: Issue): number {
  return b.updated_at.localeCompare(a.updated_at)
}

export function orderIssues(
  issues: Issue[],
  ordering: OrderingKey,
  statusOrder: readonly string[] = STATUS_ORDER,
): Issue[] {
  const sorted = [...issues]
  switch (ordering) {
    case 'priority':
      sorted.sort((a, b) => a.priority - b.priority || updatedDesc(a, b))
      break
    case 'status':
      sorted.sort(
        (a, b) =>
          statusRank(a.status, statusOrder) -
            statusRank(b.status, statusOrder) ||
          a.priority - b.priority ||
          updatedDesc(a, b),
      )
      break
    case 'updated':
      sorted.sort(updatedDesc)
      break
  }
  return sorted
}

export function groupIssues(
  issues: Issue[],
  grouping: GroupingKey,
  epicNames: Record<string, string>,
  filters: IssueFilters = [],
  statusOrder: readonly string[] = STATUS_ORDER,
): IssueGroup[] {
  if (grouping === 'none') {
    return issues.length ? [{ key: 'all', label: 'All issues', issues }] : []
  }

  if (grouping === 'status') {
    const buckets = new Map<string, Issue[]>()
    for (const issue of issues) {
      const bucket = buckets.get(issue.status)
      if (bucket) bucket.push(issue)
      else buckets.set(issue.status, [issue])
    }
    return [...buckets.entries()]
      .sort(
        ([a], [b]) =>
          statusRank(a, statusOrder) - statusRank(b, statusOrder) ||
          a.localeCompare(b),
      )
      .map(([status, issues]) => ({
        key: status,
        label: statusLabel(status),
        status,
        issues,
      }))
  }

  const buckets = new Map<string, Issue[]>()
  const push = (key: string, issue: Issue) => {
    const bucket = buckets.get(key)
    if (bucket) bucket.push(issue)
    else buckets.set(key, [issue])
  }

  if (grouping === 'project') {
    for (const issue of issues) push(issue.parent ?? NO_PROJECT_KEY, issue)
    const labelFor = (key: string) =>
      key === NO_PROJECT_KEY ? 'No project' : (epicNames[key] ?? key)
    return sortedBuckets(buckets, NO_PROJECT_KEY, labelFor)
  }

  // grouping === 'label': an issue normally appears in each of its label groups. When a
  // positive label filter is active, only the selected labels become groups — the other labels
  // on a matching issue are metadata, not additional answers to the user's filtered view.
  const selectedLabels = filters.find(
    (filter) => filter.property === 'label' && filter.operator === 'is',
  )?.values
  const visibleLabels = selectedLabels ? new Set(selectedLabels) : undefined
  for (const issue of issues) {
    const labels = issue.labels ?? []
    if (labels.length === 0 && visibleLabels?.has(NO_LABEL_KEY) !== false)
      push(NO_LABEL_KEY, issue)
    for (const label of labels) {
      if (visibleLabels === undefined || visibleLabels.has(label))
        push(label, issue)
    }
  }
  return sortedBuckets(buckets, NO_LABEL_KEY, (key) =>
    key === NO_LABEL_KEY ? 'No label' : key,
  )
}

function sortedBuckets(
  buckets: Map<string, Issue[]>,
  lastKey: string,
  labelFor: (key: string) => string,
): IssueGroup[] {
  return [...buckets.entries()]
    .map(([key, issues]) => ({ key, label: labelFor(key), issues }))
    .sort((a, b) => {
      if (a.key === lastKey) return 1
      if (b.key === lastKey) return -1
      return a.label.localeCompare(b.label)
    })
}

export interface ViewOptions {
  grouping: GroupingKey
  ordering: OrderingKey
  filters: IssueFilters
  statusOrder?: readonly string[]
}

export function buildGroups(
  issues: Issue[],
  { grouping, ordering, filters, statusOrder = STATUS_ORDER }: ViewOptions,
  epicNames: Record<string, string>,
): IssueGroup[] {
  return groupIssues(
    orderIssues(filterIssues(issues, filters, grouping), ordering, statusOrder),
    grouping,
    epicNames,
    filters,
    statusOrder,
  )
}
