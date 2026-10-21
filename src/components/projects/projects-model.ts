// ABOUTME: Pure logic for the projects view — filtering epics, ordering them (derived sorts plus
// ABOUTME: a beads-native blocking topo-sort), grouping into buckets, and computing progress.

import {
  type ActiveFilter,
  issueMatchesFilters,
} from '@/components/filters/filters'
import type { EpicStatus, Issue } from '@/lib/beads/types'
import { STATUS_ORDER, statusLabel, statusRank } from '@/lib/issue-meta'

/** The projects view layout: the flat grouped list (default) or the nested containment tree. */
export type ProjectViewMode = 'list' | 'board' | 'tree'

export type ProjectGroupingKey = 'status' | 'none'
export type ProjectOrderingKey =
  | 'priority'
  | 'updated'
  | 'created'
  | 'progress'
  | 'child-count'
  | 'title'
  | 'blocking'

/** Adjacency map epicId → ids of epics that block it (must come before it). */
export type EpicBlockingEdges = Record<string, string[]>

const NO_GROUP_KEY = 'all'

/**
 * Build the projects view's epic list from the COMPLETE epic set (bd list --type epic --all)
 * joined with progress from bd epic status. bd epic status reports only OPEN epics that have
 * children, so every other epic — childless or closed — is absent there and joins to 0/0: the
 * truth for childless epics, and an accepted loss of historical progress for closed ones (which
 * the view hides by default). The list issue is the canonical epic record (it carries labels,
 * assignee, and the blocking edges the status record omits).
 */
export function joinEpicProgress(
  epicIssues: Issue[],
  statuses: EpicStatus[],
): EpicStatus[] {
  const progressById = new Map(statuses.map((s) => [s.epic.id, s]))
  return epicIssues.map((epic) => {
    const progress = progressById.get(epic.id)
    return {
      epic,
      total_children: progress?.total_children ?? 0,
      closed_children: progress?.closed_children ?? 0,
      eligible_for_close: progress?.eligible_for_close ?? false,
    }
  })
}

/** Filters epics on their own issue fields (status, priority, labels, assignee). */
export function filterEpics(
  epics: EpicStatus[],
  filters: ActiveFilter[],
): EpicStatus[] {
  if (filters.length === 0) return epics
  return epics.filter((epic) => issueMatchesFilters(epic.epic, filters))
}

/**
 * The epics the projects view shows. Closed epics are hidden by default so "Projects" reads as
 * active work; the user reveals them through the status filter (selecting Closed pins an explicit
 * status filter, which turns the default off and lets filterEpics decide). All other filters apply
 * on top either way.
 */
export function selectVisibleEpics(
  epics: EpicStatus[],
  filters: ActiveFilter[],
): EpicStatus[] {
  const hasStatusFilter = filters.some((f) => f.property === 'status')
  const base = hasStatusFilter
    ? epics
    : epics.filter((epic) => epic.epic.status !== 'closed')
  return filterEpics(base, filters)
}

/**
 * Build the epic→blockers adjacency from epic issues' dependency edges. Only
 * `blocks`-type edges whose blocker is itself in the epic set are kept, so the
 * blocking order is an epic-only graph (edges to non-epic issues are ignored).
 */
export function buildEpicBlockingEdges(epicIssues: Issue[]): EpicBlockingEdges {
  const epicIds = new Set(epicIssues.map((issue) => issue.id))
  const edges: EpicBlockingEdges = {}
  for (const issue of epicIssues) {
    for (const dep of issue.dependencies ?? []) {
      // A `blocks` edge {issue_id, depends_on_id} means issue_id is blocked by
      // depends_on_id, so depends_on_id must happen first.
      if (dep.type !== 'blocks') continue
      if (dep.issue_id !== issue.id) continue
      if (!epicIds.has(dep.depends_on_id)) continue
      const blockers = edges[issue.id] ?? []
      blockers.push(dep.depends_on_id)
      edges[issue.id] = blockers
    }
  }
  return edges
}

/**
 * child id → its containment parent within the epic set. The `parent` field is Beads' canonical,
 * singular parent-child relationship; scheduling (`blocks`) must not make an epic look contained
 * by another epic. Non-epics render as leaf work items instead.
 */
export type EpicTreeEdges = Record<string, string[]>

export function buildEpicTreeEdges(epicIssues: Issue[]): EpicTreeEdges {
  const epicIds = new Set(epicIssues.map((issue) => issue.id))
  const edges: EpicTreeEdges = {}
  for (const issue of epicIssues) {
    if (issue.parent && epicIds.has(issue.parent))
      edges[issue.id] = [issue.parent]
  }
  return edges
}

/** A node in the projects containment tree: an epic plus its child epics. */
export interface EpicTreeNode {
  epic: EpicStatus
  children: EpicTreeNode[]
  /**
   * True when this node is a cycle's revisit — its subtree is cut to avoid infinite
   * recursion. The same epic appears in full elsewhere (at its first, acyclic visit).
   */
  cyclic: boolean
}

/**
 * Build the projects containment forest. A node's children are only epics with a
 * `parent-child` relationship to it; blockers remain relationships, not structure. Children
 * are emitted in priority-then-id order. Recursion is cycle-safe: descending into an ancestor
 * stops with a `cyclic` leaf. Every epic appears at least once — a component with no natural
 * root (a pure cycle) is seeded by its lowest priority-then-id member so nothing is dropped.
 */
export function buildEpicTree(
  epics: EpicStatus[],
  edges: EpicTreeEdges,
): EpicTreeNode[] {
  const byId = new Map(epics.map((e) => [e.epic.id, e]))

  // Invert child→parents into parent→children, restricted to the epic set.
  const childrenOf = new Map<string, string[]>()
  const hasParent = new Set<string>()
  for (const [child, parents] of Object.entries(edges)) {
    if (!byId.has(child)) continue
    for (const parent of parents) {
      if (!byId.has(parent)) continue
      hasParent.add(child)
      const list = childrenOf.get(parent)
      if (list) list.push(child)
      else childrenOf.set(parent, [child])
    }
  }

  const sortIds = (idList: string[]): string[] =>
    [...idList].sort((a, b) => {
      const ea = byId.get(a)
      const eb = byId.get(b)
      return ea && eb ? priorityThenId(ea, eb) : a.localeCompare(b)
    })

  const build = (id: string, ancestors: ReadonlySet<string>): EpicTreeNode => {
    const epic = byId.get(id) as EpicStatus
    if (ancestors.has(id)) return { epic, children: [], cyclic: true }
    const nextAncestors = new Set(ancestors).add(id)
    return {
      epic,
      cyclic: false,
      children: sortIds(childrenOf.get(id) ?? []).map((child) =>
        build(child, nextAncestors),
      ),
    }
  }

  const forest: EpicTreeNode[] = []
  const reached = new Set<string>()
  const markReached = (node: EpicTreeNode): void => {
    reached.add(node.epic.epic.id)
    for (const child of node.children) markReached(child)
  }
  const addRoot = (id: string): void => {
    const node = build(id, new Set())
    forest.push(node)
    markReached(node)
  }

  const allIds = epics.map((e) => e.epic.id)
  // Natural roots: epics nothing in-set depends on, in priority-then-id order.
  for (const id of sortIds(allIds.filter((id) => !hasParent.has(id))))
    addRoot(id)
  // Seed any remaining components (cycles where every member has a parent).
  let remaining = sortIds(allIds.filter((id) => !reached.has(id)))
  while (remaining.length > 0) {
    addRoot(remaining[0])
    remaining = sortIds(allIds.filter((id) => !reached.has(id)))
  }

  return forest
}

/**
 * The direct non-epic children of an epic — the work items the tree's "show tasks" affordance
 * reveals. Epics are excluded because they are structural nodes; every other type (task, bug,
 * chore, …) is a leaf work item under its immediate parent epic.
 */
export function selectTaskChildren(
  children: Issue[],
  parentId: string,
): Issue[] {
  return children.filter(
    (issue) => issue.issue_type !== 'epic' && issue.parent === parentId,
  )
}

function updatedDesc(a: EpicStatus, b: EpicStatus): number {
  return b.epic.updated_at.localeCompare(a.epic.updated_at)
}

function priorityThenId(a: EpicStatus, b: EpicStatus): number {
  return a.epic.priority - b.epic.priority || a.epic.id.localeCompare(b.epic.id)
}

/**
 * Order epics by the chosen key. `blocking` topo-sorts on the edges (blocker
 * before blocked); all other keys ignore the edges. Every ordering is total and
 * deterministic via the priority-then-id tiebreak.
 */
export function orderEpics(
  epics: EpicStatus[],
  ordering: ProjectOrderingKey,
  edges: EpicBlockingEdges = {},
): EpicStatus[] {
  const sorted = [...epics]
  switch (ordering) {
    case 'priority':
      sorted.sort(
        (a, b) => a.epic.priority - b.epic.priority || updatedDesc(a, b),
      )
      break
    case 'updated':
      sorted.sort(
        (a, b) => updatedDesc(a, b) || a.epic.id.localeCompare(b.epic.id),
      )
      break
    case 'created':
      sorted.sort(
        (a, b) =>
          b.epic.created_at.localeCompare(a.epic.created_at) ||
          a.epic.id.localeCompare(b.epic.id),
      )
      break
    case 'progress':
      sorted.sort(
        (a, b) =>
          progressPercent(b.closed_children, b.total_children) -
            progressPercent(a.closed_children, a.total_children) ||
          priorityThenId(a, b),
      )
      break
    case 'child-count':
      sorted.sort(
        (a, b) => b.total_children - a.total_children || priorityThenId(a, b),
      )
      break
    case 'title':
      sorted.sort(
        (a, b) =>
          a.epic.title.localeCompare(b.epic.title) ||
          a.epic.id.localeCompare(b.epic.id),
      )
      break
    case 'blocking':
      return topoOrderEpics(sorted, edges)
  }
  return sorted
}

/**
 * Kahn's algorithm with a deterministic tiebreak: among epics with no unresolved
 * blocker, emit the lowest priority-then-id first. A dependency cycle can leave
 * no zero-indegree node with epics remaining; the lowest priority-then-id node is
 * then emitted to break the cycle, so the sort always terminates.
 */
function topoOrderEpics(
  epics: EpicStatus[],
  edges: EpicBlockingEdges,
): EpicStatus[] {
  const byId = new Map(epics.map((e) => [e.epic.id, e]))
  const indegree = new Map<string, number>()
  const blocks = new Map<string, string[]>() // blocker → epics it blocks
  for (const e of epics) indegree.set(e.epic.id, 0)
  for (const e of epics) {
    for (const blocker of edges[e.epic.id] ?? []) {
      if (!byId.has(blocker)) continue
      indegree.set(e.epic.id, (indegree.get(e.epic.id) ?? 0) + 1)
      const list = blocks.get(blocker)
      if (list) list.push(e.epic.id)
      else blocks.set(blocker, [e.epic.id])
    }
  }

  const remaining = new Set(byId.keys())
  const result: EpicStatus[] = []
  const pickLowest = (ids: Iterable<string>): string | null => {
    let best: EpicStatus | null = null
    for (const id of ids) {
      const epic = byId.get(id)
      if (!epic) continue
      if (best === null || priorityThenId(epic, best) < 0) best = epic
    }
    return best?.epic.id ?? null
  }

  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) => (indegree.get(id) ?? 0) === 0)
    const pick = pickLowest(ready.length > 0 ? ready : remaining)
    if (pick === null) break
    result.push(byId.get(pick) as EpicStatus)
    remaining.delete(pick)
    for (const blocked of blocks.get(pick) ?? []) {
      if (remaining.has(blocked))
        indegree.set(blocked, (indegree.get(blocked) ?? 1) - 1)
    }
  }
  return result
}

export interface EpicGroup {
  /** Stable React key. */
  key: string
  /** Header text. */
  label: string
  /** Present only when grouping by status, so the header can render its icon. */
  status?: string
  epics: EpicStatus[]
}

/**
 * Group epics into buckets, preserving the incoming order within each bucket.
 * `status` buckets by status in STATUS_ORDER (unknown statuses last, empty groups
 * skipped); `none` returns a single bucket.
 */
export function groupEpics(
  epics: EpicStatus[],
  grouping: ProjectGroupingKey = 'status',
  statusOrder: readonly string[] = STATUS_ORDER,
): EpicGroup[] {
  if (grouping === 'none') {
    return epics.length
      ? [{ key: NO_GROUP_KEY, label: 'All projects', epics }]
      : []
  }

  const byStatus = new Map<string, EpicStatus[]>()
  for (const epic of epics) {
    const bucket = byStatus.get(epic.epic.status)
    if (bucket) bucket.push(epic)
    else byStatus.set(epic.epic.status, [epic])
  }
  return [...byStatus.entries()]
    .sort(
      ([a], [b]) =>
        statusRank(a, statusOrder) - statusRank(b, statusOrder) ||
        a.localeCompare(b),
    )
    .map(([status, group]) => ({
      key: status,
      label: statusLabel(status),
      status,
      epics: group,
    }))
}

export interface EpicViewOptions {
  grouping: ProjectGroupingKey
  ordering: ProjectOrderingKey
  filters: ActiveFilter[]
  statusOrder?: readonly string[]
}

/** Filter, order, then group epics — the full pipeline the projects view renders. */
export function buildEpicGroups(
  epics: EpicStatus[],
  { grouping, ordering, filters, statusOrder = STATUS_ORDER }: EpicViewOptions,
  edges: EpicBlockingEdges = {},
): EpicGroup[] {
  return groupEpics(
    orderEpics(selectVisibleEpics(epics, filters), ordering, edges),
    grouping,
    statusOrder,
  )
}

/** Percentage of closed children, rounded; 0 when the epic has no children. */
export function progressPercent(closed: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((closed / total) * 100)))
}
