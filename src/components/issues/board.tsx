// ABOUTME: Linear-style board view — one column per group from buildGroups, cards from
// ABOUTME: BoardCard, and dnd-kit drag-to-column status changes when grouping by status.

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useMemo, useRef, useState } from 'react'
import { buildBlockedIds } from '@/lib/beads/blocked'
import type { Issue } from '@/lib/beads/types'
import { StatusIcon } from '@/lib/issue-meta'
import { cn } from '@/lib/utils'
import { BoardCard } from './board-card'
import {
  boardCardProperties,
  dragEnabled,
  orderBoardGroups,
  statusAfterDrop,
} from './board-logic'
import {
  buildGroups,
  DEFAULT_DISPLAY_PROPERTIES,
  type DisplayProperty,
  type IssueGroup,
  type ViewOptions,
} from './grouping'

interface IssuesBoardProps {
  issues: Issue[]
  epicNames: Record<string, string>
  options: ViewOptions
  displayProperties?: ReadonlySet<DisplayProperty>
  onCardClick: (id: string) => void
  /** Persist a drag-initiated status change; the board disables the card meanwhile. */
  onStatusChange: (id: string, status: string) => Promise<void>
}

export function IssuesBoard({
  issues,
  epicNames,
  options,
  displayProperties = DEFAULT_DISPLAY_PROPERTIES,
  onCardClick,
  onStatusChange,
}: IssuesBoardProps) {
  const groups = useMemo(
    () =>
      orderBoardGroups(
        buildGroups(issues, options, epicNames),
        options.grouping,
        options.statusOrder,
      ),
    [issues, options, epicNames],
  )
  const issuesById = useMemo(
    () => new Map(issues.map((i) => [i.id, i])),
    [issues],
  )
  // Edge-derived blocked set: a blocks edge to a non-closed issue in the loaded set (R11).
  const blockedIds = useMemo(() => buildBlockedIds(issues), [issues])
  const properties = boardCardProperties(displayProperties)
  const canDrag = dragEnabled(options.grouping)
  const [savingId, setSavingId] = useState<string | null>(null)
  // A click fires on the card right after a drop; remember the dragged card
  // briefly so that click doesn't also open the side panel.
  const justDraggedRef = useRef<string | null>(null)

  // Distance activation keeps plain clicks (open panel) distinct from drags.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  async function handleDragEnd(event: DragEndEvent) {
    const id = String(event.active.id)
    justDraggedRef.current = id
    setTimeout(() => {
      justDraggedRef.current = null
    }, 100)
    if (!event.over) return
    const issue = issuesById.get(id)
    if (!issue) return
    const status = statusAfterDrop(issue, String(event.over.id))
    if (status === null) return
    setSavingId(id)
    try {
      await onStatusChange(id, status)
    } finally {
      setSavingId(null)
    }
  }

  function handleCardClick(id: string) {
    if (justDraggedRef.current === id) return
    onCardClick(id)
  }

  if (groups.length === 0) {
    return (
      <div className="p-8 text-center text-[13px] text-muted-foreground">
        No issues match the current filters
      </div>
    )
  }

  return (
    // Stable id keeps dnd-kit's generated aria ids consistent across SSR and client.
    <DndContext id="issues-board" sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto px-4 py-3 text-[13px]">
        {groups.map((group) => (
          <BoardColumn key={group.key} group={group} canDrop={canDrag}>
            {group.issues.map((issue) => (
              <DraggableCard
                key={issue.id}
                issue={issue}
                disabled={!canDrag || savingId !== null}
              >
                <BoardCard
                  issue={issue}
                  epicNames={epicNames}
                  properties={properties}
                  blocked={blockedIds.has(issue.id)}
                  saving={savingId === issue.id}
                  onClick={() => handleCardClick(issue.id)}
                />
              </DraggableCard>
            ))}
          </BoardColumn>
        ))}
      </div>
    </DndContext>
  )
}

function BoardColumn({
  group,
  canDrop,
  children,
}: {
  group: IssueGroup
  canDrop: boolean
  children: React.ReactNode
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: group.key,
    disabled: !canDrop,
  })
  return (
    <section
      ref={setNodeRef}
      data-board-column={group.key}
      className={cn(
        'flex max-h-full w-80 shrink-0 flex-col rounded-lg bg-muted/40 transition-colors',
        isOver && 'bg-muted/70 ring-1 ring-ring/40',
      )}
    >
      <header className="sticky top-0 flex items-center gap-2 rounded-t-lg px-3 py-2.5">
        {group.status ? <StatusIcon status={group.status} /> : null}
        <span className="font-medium">{group.label}</span>
        <span className="text-xs text-muted-foreground">
          {group.issues.length}
        </span>
      </header>
      <div className="flex min-h-8 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {children}
      </div>
    </section>
  )
}

function DraggableCard({
  issue,
  disabled,
  children,
}: {
  issue: Issue
  disabled: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: issue.id, disabled })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(isDragging && 'z-10 opacity-80')}
      style={
        transform
          ? {
              transform: `translate(${transform.x}px, ${transform.y}px)`,
            }
          : undefined
      }
    >
      {children}
    </div>
  )
}
