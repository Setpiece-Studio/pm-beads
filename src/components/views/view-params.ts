// ABOUTME: Pure saved-view param logic — canonical normalization of view params per route
// ABOUTME: (defaults omitted, same rules the routes use), deep equality, and view id generation.

import { parseFilters, serializeFilters } from '@/components/filters/filters'
import {
  parseDisplayProperties,
  serializeDisplayProperties,
} from '@/components/issues/grouping'
import {
  parseProjectProperties,
  serializeProjectProperties,
} from '@/components/projects/project-properties'

export const VIEW_ROUTES = ['issues', 'projects'] as const
export type ViewRoute = (typeof VIEW_ROUTES)[number]

/** The view-shape params a saved view may carry. project/issue are never included. */
export interface SavedViewParams {
  view?: 'board' | 'tree' | 'gantt'
  grouping?: 'status' | 'project' | 'label' | 'none'
  ordering?:
    | 'priority'
    | 'status'
    | 'updated'
    | 'created'
    | 'progress'
    | 'child-count'
    | 'title'
    | 'blocking'
  display?: string
  filter?: string
}

/** Unvalidated param values as they arrive from a URL or stored JSON. */
export type RawViewParams = Partial<
  Record<
    | 'view'
    | 'grouping'
    | 'ordering'
    | 'display'
    | 'filter'
    | 'project'
    | 'issue',
    string
  >
>

export interface SavedView {
  id: string
  name: string
  route: ViewRoute
  params: SavedViewParams
}

const GROUPINGS = ['status', 'project', 'label', 'none'] as const
const ORDERINGS = ['priority', 'status', 'updated'] as const

// The projects view groups epics by status or not at all, and orders by derived
// epic fields plus the beads-native blocking topo-sort.
const PROJECT_GROUPINGS = ['status', 'none'] as const
const PROJECT_ORDERINGS = [
  'priority',
  'updated',
  'created',
  'progress',
  'child-count',
  'title',
  'blocking',
] as const

// Route defaults that the URL omits; normalization strips them so explicit and
// implicit defaults compare equal. Both routes share these defaults.
const DEFAULT_GROUPING = 'status'
const DEFAULT_ORDERING = 'priority'

function normalizedFilter(raw: string | undefined): string | undefined {
  // parse+serialize round-trip drops invalid clauses, dedupes values, and
  // collapses an empty filter to undefined — the routes' own canonical form.
  return serializeFilters(parseFilters(raw))
}

function normalizedDisplay(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  // Round-trip drops unknown names, orders names canonically, and collapses
  // the default property set back to undefined.
  return serializeDisplayProperties(parseDisplayProperties(raw))
}

/**
 * Canonicalize raw search-param values into the stored/compared form for a route.
 * Defaults are omitted, unknown values dropped, and keys outside the route's
 * view shape (notably project/issue) never pass through.
 */
export function normalizeViewParams(
  route: ViewRoute,
  raw: RawViewParams,
): SavedViewParams {
  const filter = normalizedFilter(raw.filter)
  if (route === 'projects') {
    // Gantt has fixed owner grouping, planned ordering, and its own display fields.
    if (raw.view === 'gantt')
      return filter ? { view: 'gantt', filter } : { view: 'gantt' }
    // The projects view shape is view (list default / tree) + grouping + ordering +
    // filter (no display properties), with its own grouping/ordering vocabulary.
    const params: SavedViewParams = {}
    if (raw.view === 'tree' || raw.view === 'board') params.view = raw.view
    const display = serializeProjectProperties(
      parseProjectProperties(raw.display),
    )
    if (display !== undefined) params.display = display
    if (
      raw.grouping !== undefined &&
      raw.grouping !== DEFAULT_GROUPING &&
      (PROJECT_GROUPINGS as readonly string[]).includes(raw.grouping)
    ) {
      params.grouping = raw.grouping as SavedViewParams['grouping']
    }
    if (
      raw.ordering !== undefined &&
      raw.ordering !== DEFAULT_ORDERING &&
      (PROJECT_ORDERINGS as readonly string[]).includes(raw.ordering)
    ) {
      params.ordering = raw.ordering as SavedViewParams['ordering']
    }
    if (filter !== undefined) params.filter = filter
    return params
  }

  const params: SavedViewParams = {}
  if (raw.view === 'board') params.view = 'board'
  if (
    raw.grouping !== undefined &&
    raw.grouping !== DEFAULT_GROUPING &&
    (GROUPINGS as readonly string[]).includes(raw.grouping)
  ) {
    params.grouping = raw.grouping as SavedViewParams['grouping']
  }
  if (
    raw.ordering !== undefined &&
    raw.ordering !== DEFAULT_ORDERING &&
    (ORDERINGS as readonly string[]).includes(raw.ordering)
  ) {
    params.ordering = raw.ordering as SavedViewParams['ordering']
  }
  const display = normalizedDisplay(raw.display)
  if (display !== undefined) params.display = display
  if (filter !== undefined) params.filter = filter
  return params
}

const PARAM_KEYS = [
  'view',
  'grouping',
  'ordering',
  'display',
  'filter',
] as const

/** Deep equality of two raw param records after normalization for the route. */
export function viewParamsEqual(
  route: ViewRoute,
  a: RawViewParams,
  b: RawViewParams,
): boolean {
  const na = normalizeViewParams(route, a)
  const nb = normalizeViewParams(route, b)
  return PARAM_KEYS.every((key) => na[key] === nb[key])
}

/** Generate a view id. Injectable source keeps the module pure and testable. */
export function generateViewId(
  randomId: () => string = () => crypto.randomUUID(),
): string {
  return randomId()
}
