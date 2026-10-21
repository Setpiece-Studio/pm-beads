// ABOUTME: Pure filter logic shared by the issues and projects views — active-filter types,
// ABOUTME: per-property match semantics, compact URL serialization, and state helpers.

import type { Issue } from '@/lib/beads/types'
import { priorityLabel, STATUS_ORDER, statusLabel } from '@/lib/issue-meta'

export const FILTER_PROPERTIES = [
  'status',
  'type',
  'priority',
  'assignee',
  'label',
  'project',
] as const

export type FilterProperty = (typeof FILTER_PROPERTIES)[number]

// Per-view property sets: issues filter on everything; epics on the projects view
// have no issue type of interest and ARE the projects, so neither applies.
export const ISSUE_FILTER_PROPERTIES: readonly FilterProperty[] =
  FILTER_PROPERTIES

export const EPIC_FILTER_PROPERTIES: readonly FilterProperty[] = [
  'status',
  'priority',
  'label',
  'assignee',
]
export type FilterOperator = 'is' | 'is-not'

export interface ActiveFilter {
  property: FilterProperty
  operator: FilterOperator
  values: string[]
}

/** Sentinel for "no assignee" / "no label" / "no project" pseudo-values. */
export const NONE_VALUE = '__none__'

export const FILTER_PROPERTY_LABELS: Record<FilterProperty, string> = {
  status: 'Status',
  type: 'Type',
  priority: 'Priority',
  assignee: 'Assignee',
  label: 'Labels',
  project: 'Project',
}

// Plural noun used in multi-value chip summaries, e.g. "2 statuses".
const FILTER_PROPERTY_NOUNS: Record<FilterProperty, string> = {
  status: 'statuses',
  type: 'types',
  priority: 'priorities',
  assignee: 'assignees',
  label: 'labels',
  project: 'projects',
}

const ISSUE_TYPES = ['task', 'bug', 'feature', 'chore'] as const

function isFilterProperty(value: string): value is FilterProperty {
  return (FILTER_PROPERTIES as readonly string[]).includes(value)
}

function isFilterOperator(value: string): value is FilterOperator {
  return value === 'is' || value === 'is-not'
}

// --- Matching -------------------------------------------------------------

// Every property reduces to "the issue's values for this property", so a single
// any-overlap test covers both single-valued properties and multi-valued labels.
function issueValuesFor(issue: Issue, property: FilterProperty): string[] {
  switch (property) {
    case 'status':
      return [issue.status]
    case 'type':
      return [issue.issue_type]
    case 'priority':
      return [String(issue.priority)]
    case 'assignee':
      return [issue.assignee ?? NONE_VALUE]
    case 'project':
      return [issue.parent ?? NONE_VALUE]
    case 'label':
      return issue.labels?.length ? issue.labels : [NONE_VALUE]
  }
}

export function issueMatchesFilters(
  issue: Issue,
  filters: ActiveFilter[],
): boolean {
  return filters.every((filter) => {
    if (filter.values.length === 0) return true
    const hit = issueValuesFor(issue, filter.property).some((v) =>
      filter.values.includes(v),
    )
    return filter.operator === 'is' ? hit : !hit
  })
}

// --- URL serialization ----------------------------------------------------
// Scheme: one `filter` search param; clauses joined by ';', each clause is
// property:operator:value,value with every value percent-encoded so the
// delimiters (':' ',' ';') are unambiguous. Example:
//   filter=status:is:open,in_progress;label:is-not:bug

export function serializeFilters(filters: ActiveFilter[]): string | undefined {
  if (filters.length === 0) return undefined
  return filters
    .map(
      (f) =>
        `${f.property}:${f.operator}:${f.values
          .map(encodeURIComponent)
          .join(',')}`,
    )
    .join(';')
}

export function parseFilters(param: string | undefined): ActiveFilter[] {
  if (!param) return []
  const seen = new Set<FilterProperty>()
  const filters: ActiveFilter[] = []
  for (const clause of param.split(';')) {
    const [property, operator, rawValues] = clause.split(':', 3)
    if (!property || !operator || !rawValues) continue
    if (!isFilterProperty(property) || !isFilterOperator(operator)) continue
    if (seen.has(property)) continue
    const values = [
      ...new Set(rawValues.split(',').filter(Boolean).map(decodeURIComponent)),
    ]
    if (values.length === 0) continue
    seen.add(property)
    filters.push({ property, operator, values })
  }
  return filters
}

// --- State helpers (one active filter per property, Linear-style) ----------

export function toggleFilterValue(
  filters: ActiveFilter[],
  property: FilterProperty,
  value: string,
): ActiveFilter[] {
  const existing = filters.find((f) => f.property === property)
  if (!existing) {
    return [...filters, { property, operator: 'is', values: [value] }]
  }
  const values = existing.values.includes(value)
    ? existing.values.filter((v) => v !== value)
    : [...existing.values, value]
  if (values.length === 0) return removeFilter(filters, property)
  return filters.map((f) => (f.property === property ? { ...f, values } : f))
}

export function setFilterOperator(
  filters: ActiveFilter[],
  property: FilterProperty,
  operator: FilterOperator,
): ActiveFilter[] {
  return filters.map((f) => (f.property === property ? { ...f, operator } : f))
}

export function removeFilter(
  filters: ActiveFilter[],
  property: FilterProperty,
): ActiveFilter[] {
  return filters.filter((f) => f.property !== property)
}

// --- Chip display text ------------------------------------------------------

export function operatorLabel(
  operator: FilterOperator,
  valueCount: number,
): string {
  if (operator === 'is') return valueCount > 1 ? 'is any of' : 'is'
  return valueCount > 1 ? 'is not any of' : 'is not'
}

export interface FilterValueOption {
  value: string
  label: string
}

export function valueSummary(
  filter: ActiveFilter,
  options: FilterValueOption[],
): string {
  if (filter.values.length === 1) {
    const value = filter.values[0]
    return options.find((o) => o.value === value)?.label ?? value
  }
  return `${filter.values.length} ${FILTER_PROPERTY_NOUNS[filter.property]}`
}

// --- Value-option derivation ------------------------------------------------

export function filterValueOptions(
  property: FilterProperty,
  issues: Issue[],
  epics: { id: string; title: string }[],
  statusOrder: readonly string[] = STATUS_ORDER,
): FilterValueOption[] {
  switch (property) {
    case 'status': {
      const extras = [...new Set(issues.map((i) => i.status))].filter(
        (s) => !statusOrder.includes(s),
      )
      return [...statusOrder, ...extras.sort()].map((s) => ({
        value: s,
        label: statusLabel(s),
      }))
    }
    case 'type':
      return ISSUE_TYPES.map((t) => ({ value: t, label: t }))
    case 'priority':
      return [0, 1, 2, 3, 4].map((p) => ({
        value: String(p),
        label: priorityLabel(p),
      }))
    case 'label': {
      const labels = [...new Set(issues.flatMap((i) => i.labels ?? []))].sort()
      return [
        ...labels.map((l) => ({ value: l, label: l })),
        { value: NONE_VALUE, label: 'No label' },
      ]
    }
    case 'assignee': {
      const assignees = [
        ...new Set(
          issues.map((i) => i.assignee).filter((a): a is string => Boolean(a)),
        ),
      ].sort()
      return [
        ...assignees.map((a) => ({ value: a, label: a })),
        { value: NONE_VALUE, label: 'No assignee' },
      ]
    }
    case 'project':
      return [
        ...epics
          .map((e) => ({ value: e.id, label: e.title }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        { value: NONE_VALUE, label: 'No project' },
      ]
  }
}
