// ABOUTME: Pure ordering logic behind the detail top bar's n/N navigation — flattens the list
// ABOUTME: views' own filter/order/group models into an id sequence and locates a row's neighbours.

import type { ActiveFilter } from '@/components/filters/filters'
import {
  orderBoardGroups,
  type ViewMode,
} from '@/components/issues/board-logic'
import {
  buildGroups,
  type GroupingKey,
  type OrderingKey,
} from '@/components/issues/grouping'
import {
  buildEpicGroups,
  type EpicBlockingEdges,
  type ProjectGroupingKey,
  type ProjectOrderingKey,
} from '@/components/projects/projects-model'
import {
  DEFAULT_STATUS_PIPELINE,
  listStatusOrder,
  type StatusPipeline,
} from '@/lib/beads/status-model'
import type { EpicStatus, Issue } from '@/lib/beads/types'

/** Where an item sits in the list it was opened from, plus the ids either side of it. */
export interface SiblingNav {
  /** 1-based position, as rendered ("3 / 12"). */
  index: number
  total: number
  /** Absent at the first row. */
  previousId?: string
  /** Absent at the last row. */
  nextId?: string
}

/** The issues view's URL-carried shape — exactly what the list route reads from its search. */
export interface IssueListContext {
  grouping: GroupingKey
  ordering: OrderingKey
  filters: ActiveFilter[]
  view: ViewMode
}

/** The projects view's URL-carried shape. Tree mode is not a linear list and is excluded. */
export interface EpicListContext {
  grouping: ProjectGroupingKey
  ordering: ProjectOrderingKey
  filters: ActiveFilter[]
}

/**
 * Reading order of the issues list: the same groups the view renders, concatenated top to
 * bottom. Board mode reorders the status columns (its left→right pipeline is its reading
 * order), and label grouping repeats an issue under each of its labels — the first
 * occurrence wins so a position is unambiguous.
 *
 * `pipeline` is the selected project's, and the two views' split defaults are reproduced from
 * it exactly as the list routes do — board columns in pipeline order, grouped rows in list
 * order — so the top bar's n/N walks the list the row was opened from rather than a
 * built-in order the project may never use.
 */
export function orderedIssueIds(
  issues: Issue[],
  context: IssueListContext,
  epicNames: Record<string, string>,
  pipeline: StatusPipeline = DEFAULT_STATUS_PIPELINE,
): string[] {
  const board = context.view === 'board'
  const statusOrder = board ? pipeline.statuses : listStatusOrder(pipeline)
  const groups = buildGroups(
    issues,
    {
      grouping: context.grouping,
      ordering: context.ordering,
      filters: context.filters,
      statusOrder,
    },
    epicNames,
  )
  const ordered = board
    ? orderBoardGroups(groups, context.grouping, statusOrder)
    : groups
  return dedupe(ordered.flatMap((group) => group.issues.map((i) => i.id)))
}

/** Reading order of the projects list, built from the same grouped/ordered epic model. */
export function orderedEpicIds(
  epics: EpicStatus[],
  context: EpicListContext,
  edges: EpicBlockingEdges = {},
  pipeline: StatusPipeline = DEFAULT_STATUS_PIPELINE,
): string[] {
  const groups = buildEpicGroups(
    epics,
    {
      grouping: context.grouping,
      ordering: context.ordering,
      filters: context.filters,
      statusOrder: listStatusOrder(pipeline),
    },
    edges,
  )
  return dedupe(groups.flatMap((group) => group.epics.map((e) => e.epic.id)))
}

/**
 * Locate an id in a reading order. Null when the item isn't in the list at all — a deep link,
 * or a row the current filters hide — which the top bar renders as "—" rather than a position.
 */
export function siblingNav(
  orderedIds: readonly string[],
  currentId: string,
): SiblingNav | null {
  const index = orderedIds.indexOf(currentId)
  if (index === -1) return null
  return {
    index: index + 1,
    total: orderedIds.length,
    previousId: index > 0 ? orderedIds[index - 1] : undefined,
    nextId: index < orderedIds.length - 1 ? orderedIds[index + 1] : undefined,
  }
}

/**
 * The breadcrumb's leading crumb: the selected beads project's directory name, or the
 * env-default project's name when no project is selected.
 */
export function projectDisplayName(
  projectPath: string | undefined,
  defaultName: string,
): string {
  if (!projectPath) return defaultName
  return projectPath.split('/').filter(Boolean).pop() ?? projectPath
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)]
}
