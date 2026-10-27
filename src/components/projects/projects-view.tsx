// ABOUTME: Linear-style projects view — filter bar over epics grouped by status with
// ABOUTME: collapsible headers, and per-epic inline expansion of lazily fetched children.

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { FilterBar } from '@/components/filters/filter-bar'
import {
  type ActiveFilter,
  EPIC_FILTER_PROPERTIES,
  type FilterProperty,
  type FilterValueOption,
} from '@/components/filters/filters'
import type { EpicStatus, Issue } from '@/lib/beads/types'
import {
  BeadId,
  beadRefTitle,
  LabelPill,
  PriorityIcon,
  StatusIcon,
} from '@/lib/issue-meta'
import { EpicTree } from './epic-tree'
import { ProjectFields } from './project-properties'
import { ProjectsBoard } from './projects-board'
import {
  ProjectsDisplayOptions,
  type ProjectsDisplayOptionsPatch,
} from './projects-display-options'
import { ProjectsGantt } from './projects-gantt'
import { buildGantt } from './projects-gantt-model'
import {
  buildEpicGroups,
  buildEpicTree,
  type EpicBlockingEdges,
  type EpicTreeEdges,
  type ProjectGroupingKey,
  type ProjectOrderingKey,
  type ProjectViewMode,
  selectVisibleEpics,
} from './projects-model'
import { type FetchChildren, useEpicChildren } from './use-epic-children'

export interface ProjectsViewProps {
  boardStatuses?: readonly string[]
  onStatusChange?: (id: string, status: string) => Promise<void>
  epics: EpicStatus[]
  ganttIssues?: Issue[]
  filters: ActiveFilter[]
  /** List (flat grouped) or the nested containment tree. */
  view: ProjectViewMode
  grouping: ProjectGroupingKey
  ordering: ProjectOrderingKey
  statusOrder?: readonly string[]
  /** Epic→blockers adjacency for the blocking order; unused by other orderings. */
  edges: EpicBlockingEdges
  /** Parent-child child→parent adjacency the containment tree nests on. */
  treeEdges: EpicTreeEdges
  valueOptions: Partial<Record<FilterProperty, FilterValueOption[]>>
  onFiltersChange: (filters: ActiveFilter[]) => void
  onViewOptionsChange: (patch: ProjectsDisplayOptionsPatch) => void
  fetchChildren: FetchChildren
  /** Epic row click → the project detail route. */
  onSelectEpic: (id: string) => void
  /** Child issue row click → the issue detail route. */
  onSelectIssue: (id: string) => void
}

export function ProjectsView({
  epics,
  ganttIssues = [],
  filters,
  view,
  grouping,
  ordering,
  statusOrder,
  edges,
  treeEdges,
  valueOptions,
  onFiltersChange,
  onViewOptionsChange,
  fetchChildren,
  onSelectEpic,
  onSelectIssue,
  boardStatuses = [],
  onStatusChange = async () => {},
}: ProjectsViewProps) {
  const gantt = useMemo(
    () =>
      view === 'gantt'
        ? buildGantt(
            selectVisibleEpics(epics, filters).map((entry) => entry.epic),
            ganttIssues,
            edges,
          )
        : undefined,
    [view, epics, filters, ganttIssues, edges],
  )
  const groups = buildEpicGroups(
    epics,
    { grouping, ordering, filters, statusOrder },
    edges,
  )
  // The tree nests the same visible set (closed hidden, filters applied) the list groups.
  const treeNodes =
    view === 'tree'
      ? buildEpicTree(selectVisibleEpics(epics, filters), treeEdges)
      : []
  const expansion = useEpicChildren(fetchChildren)
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    new Set(),
  )

  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className="flex flex-col text-[13px]">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-1.5">
        <FilterBar
          properties={EPIC_FILTER_PROPERTIES}
          filters={filters}
          valueOptions={valueOptions}
          onChange={onFiltersChange}
        />
        <div className="ml-auto">
          <ProjectsDisplayOptions
            view={view}
            grouping={grouping}
            ordering={ordering}
            onChange={onViewOptionsChange}
            gantt={gantt}
          />
        </div>
      </div>
      {gantt ? (
        <ProjectsGantt model={gantt} onSelect={onSelectEpic} />
      ) : view === 'board' ? (
        <ProjectsBoard
          epics={groups.flatMap((group) => group.epics)}
          statuses={boardStatuses}
          onSelect={onSelectEpic}
          onStatusChange={onStatusChange}
        />
      ) : view === 'tree' ? (
        treeNodes.length === 0 ? (
          <div className="p-6 text-[13px] text-muted-foreground">
            {epics.length === 0
              ? 'No epics yet'
              : 'No epics match the current filters'}
          </div>
        ) : (
          <EpicTree
            nodes={treeNodes}
            fetchChildren={fetchChildren}
            onSelectEpic={onSelectEpic}
            onSelectIssue={onSelectIssue}
          />
        )
      ) : (
        <ListGroups
          groups={groups}
          epicCount={epics.length}
          collapsedGroups={collapsedGroups}
          toggleGroup={toggleGroup}
          expansion={expansion}
          onSelectEpic={onSelectEpic}
          onSelectIssue={onSelectIssue}
        />
      )}
    </div>
  )
}

function ListGroups({
  groups,
  epicCount,
  collapsedGroups,
  toggleGroup,
  expansion,
  onSelectEpic,
  onSelectIssue,
}: {
  groups: ReturnType<typeof buildEpicGroups>
  epicCount: number
  collapsedGroups: ReadonlySet<string>
  toggleGroup: (key: string) => void
  expansion: ReturnType<typeof useEpicChildren>
  onSelectEpic: (id: string) => void
  onSelectIssue: (id: string) => void
}) {
  return (
    <>
      {groups.length === 0 && (
        <div className="p-6 text-[13px] text-muted-foreground">
          {epicCount === 0
            ? 'No epics yet'
            : 'No epics match the current filters'}
        </div>
      )}
      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.key)
        const Chevron = collapsed ? ChevronRight : ChevronDown
        return (
          <section key={group.key}>
            <button
              type="button"
              onClick={() => toggleGroup(group.key)}
              className="group flex h-8 w-full items-center gap-2 bg-muted/40 px-4 text-left hover:bg-muted/60"
              aria-expanded={!collapsed}
            >
              <Chevron className="size-3.5 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
              {group.status !== undefined && (
                <StatusIcon status={group.status} />
              )}
              <span className="font-medium">{group.label}</span>
              <span className="text-xs text-muted-foreground">
                {group.epics.length}
              </span>
            </button>
            {!collapsed &&
              group.epics.map((epic) => (
                <EpicRow
                  key={epic.epic.id}
                  epic={epic}
                  expansion={expansion}
                  onSelectEpic={onSelectEpic}
                  onSelectIssue={onSelectIssue}
                />
              ))}
          </section>
        )
      })}
    </>
  )
}

function EpicRow({
  epic,
  expansion,
  onSelectEpic,
  onSelectIssue,
}: {
  epic: EpicStatus
  expansion: ReturnType<typeof useEpicChildren>
  onSelectEpic: (id: string) => void
  onSelectIssue: (id: string) => void
}) {
  const { id, title } = epic.epic
  const isExpanded = expansion.isExpanded(id)
  const children = expansion.children(id)
  const error = expansion.error(id)

  return (
    <div>
      <div className="flex h-9 w-full items-center gap-2 px-4 hover:bg-accent/60">
        <button
          type="button"
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${title}`}
          onClick={() => expansion.toggle(id)}
          className="rounded p-0.5 text-muted-foreground/60 hover:bg-accent hover:text-foreground"
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onSelectEpic(id)}
          title={beadRefTitle(id, title)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <ProjectFields epic={epic} />
        </button>
      </div>
      {isExpanded && (
        <div className="bg-muted/20">
          {expansion.isLoading(id) && (
            <div className="py-1.5 pl-14 pr-4 text-xs text-muted-foreground">
              Loading issues…
            </div>
          )}
          {error && (
            <div className="py-1.5 pl-14 pr-4 text-xs text-red-500">
              Failed to load issues: {error}
            </div>
          )}
          {children?.length === 0 && (
            <div className="py-1.5 pl-14 pr-4 text-xs text-muted-foreground">
              No child issues
            </div>
          )}
          {children?.map((child) => (
            <ChildIssueRow
              key={child.id}
              issue={child}
              onSelect={() => onSelectIssue(child.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ChildIssueRow({
  issue,
  onSelect,
}: {
  issue: Issue
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={beadRefTitle(issue.id, issue.title)}
      className="flex h-8 w-full cursor-pointer items-center gap-2 pl-14 pr-4 text-left hover:bg-accent/60"
    >
      <PriorityIcon priority={issue.priority} />
      <StatusIcon status={issue.status} />
      <span className="min-w-0 flex-1 truncate text-foreground">
        {issue.title}
      </span>
      <BeadId id={issue.id} className="max-w-28 truncate" />
      {issue.labels?.map((label) => (
        <LabelPill key={label} label={label} />
      ))}
    </button>
  )
}
