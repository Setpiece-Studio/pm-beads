// ABOUTME: Recursive containment-tree rendering for Projects — epics nested only by parent-child
// ABOUTME: edges, with per-epic expand/collapse and a direct-child task reveal.

import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { Issue } from '@/lib/beads/types'
import {
  BeadId,
  beadRefTitle,
  LabelPill,
  PriorityIcon,
  StatusIcon,
} from '@/lib/issue-meta'
import { ProjectFields } from './project-properties'
import type { EpicTreeNode } from './projects-model'
import { selectTaskChildren } from './projects-model'
import { type FetchChildren, useEpicChildren } from './use-epic-children'

interface EpicTreeProps {
  nodes: EpicTreeNode[]
  fetchChildren: FetchChildren
  onSelectEpic: (id: string) => void
  onSelectIssue: (id: string) => void
}

/**
 * Renders the projects containment forest. Collapse state and the show-tasks reveal are keyed by
 * epic id. Nodes default to expanded so the view reads like the terminal `bd list` tree.
 */
export function EpicTree({
  nodes,
  fetchChildren,
  onSelectEpic,
  onSelectIssue,
}: EpicTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const tasks = useEpicChildren(fetchChildren)

  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (nodes.length === 0) return null
  return (
    <div>
      {nodes.map((node) => (
        <TreeRow
          key={node.epic.epic.id}
          node={node}
          depth={0}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          tasks={tasks}
          onSelectEpic={onSelectEpic}
          onSelectIssue={onSelectIssue}
        />
      ))}
    </div>
  )
}

interface TreeRowProps {
  node: EpicTreeNode
  depth: number
  collapsed: ReadonlySet<string>
  onToggleCollapse: (id: string) => void
  tasks: ReturnType<typeof useEpicChildren>
  onSelectEpic: (id: string) => void
  onSelectIssue: (id: string) => void
}

/** Indentation in pixels for a row at the given tree depth. */
const indentFor = (depth: number) => 12 + depth * 18

function TreeRow({
  node,
  depth,
  collapsed,
  onToggleCollapse,
  tasks,
  onSelectEpic,
  onSelectIssue,
}: TreeRowProps) {
  const { id, title } = node.epic.epic
  const indent = indentFor(depth)

  // A cycle's revisit: render a muted marker pointing back at the epic and stop — its full
  // subtree appears at the epic's first (acyclic) occurrence.
  if (node.cyclic) {
    return (
      <div
        className="flex h-8 items-center gap-2 pr-4 text-xs text-muted-foreground/70"
        style={{ paddingLeft: indent + 22 }}
      >
        <RotateCcw className="size-3" />
        <span className="truncate" title={beadRefTitle(id, title)}>
          {title} · {id} (cycle)
        </span>
      </div>
    )
  }

  const hasEpicChildren = node.children.length > 0
  const isCollapsed = collapsed.has(id)
  const showTasks = tasks.isExpanded(id)
  const taskChildren = selectTaskChildren(tasks.children(id) ?? [], id)

  return (
    <div>
      <div
        className="flex h-9 items-center gap-2 pr-4 hover:bg-accent/60"
        style={{ paddingLeft: indent }}
      >
        {hasEpicChildren ? (
          <button
            type="button"
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${title}`}
            onClick={() => onToggleCollapse(id)}
            className="rounded p-0.5 text-muted-foreground/60 hover:bg-accent hover:text-foreground"
          >
            {isCollapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="size-[18px] shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelectEpic(id)}
          title={beadRefTitle(id, title)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          <ProjectFields epic={node.epic} />
        </button>
        <button
          type="button"
          aria-label={`${showTasks ? 'Hide' : 'Show'} tasks for ${title}`}
          onClick={() => tasks.toggle(id)}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        >
          {showTasks ? 'hide tasks' : 'tasks'}
        </button>
      </div>

      {showTasks && (
        <TaskList
          depth={depth}
          isLoading={tasks.isLoading(id)}
          error={tasks.error(id)}
          loaded={tasks.children(id) !== undefined}
          tasks={taskChildren}
          onSelectIssue={onSelectIssue}
        />
      )}

      {hasEpicChildren &&
        !isCollapsed &&
        node.children.map((child) => (
          <TreeRow
            key={child.epic.epic.id}
            node={child}
            depth={depth + 1}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
            tasks={tasks}
            onSelectEpic={onSelectEpic}
            onSelectIssue={onSelectIssue}
          />
        ))}
    </div>
  )
}

interface TaskListProps {
  depth: number
  isLoading: boolean
  error: string | undefined
  loaded: boolean
  tasks: Issue[]
  onSelectIssue: (id: string) => void
}

/** The non-epic work items revealed under an epic by the show-tasks toggle. */
function TaskList({
  depth,
  isLoading,
  error,
  loaded,
  tasks,
  onSelectIssue,
}: TaskListProps) {
  const indent = indentFor(depth + 1) + 22
  return (
    <div className="bg-muted/20">
      {isLoading && (
        <div
          className="py-1.5 text-xs text-muted-foreground"
          style={{ paddingLeft: indent }}
        >
          Loading tasks…
        </div>
      )}
      {error && (
        <div
          className="py-1.5 text-xs text-red-500"
          style={{ paddingLeft: indent }}
        >
          Failed to load tasks: {error}
        </div>
      )}
      {loaded && !isLoading && tasks.length === 0 && (
        <div
          className="py-1.5 text-xs text-muted-foreground"
          style={{ paddingLeft: indent }}
        >
          No tasks
        </div>
      )}
      {tasks.map((issue) => (
        <button
          key={issue.id}
          type="button"
          onClick={() => onSelectIssue(issue.id)}
          style={{ paddingLeft: indent }}
          title={beadRefTitle(issue.id, issue.title)}
          className="flex h-8 w-full cursor-pointer items-center gap-2 pr-4 text-left hover:bg-accent/60"
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
      ))}
    </div>
  )
}
