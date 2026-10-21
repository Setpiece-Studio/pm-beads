// ABOUTME: Project board preserves project ordering within configured pipeline columns.
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useRef, useState } from 'react'
import type { EpicStatus } from '@/lib/beads/types'
import { StatusIcon, statusLabel } from '@/lib/issue-meta'
import { ProjectFields } from './project-properties'

export function ProjectsBoard({
  epics,
  statuses,
  onSelect,
  onStatusChange,
}: {
  epics: EpicStatus[]
  statuses: readonly string[]
  onSelect: (id: string) => void
  onStatusChange: (id: string, status: string) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragged = useRef(false)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )
  return (
    <>
      <p role={error ? 'alert' : undefined}>{error}</p>
      <DndContext
        id="projects-board"
        sensors={sensors}
        onDragStart={() => {
          dragged.current = true
        }}
        onDragEnd={async (event) => {
          setTimeout(() => {
            dragged.current = false
          }, 100)
          const id = String(event.active.id)
          const status = event.over ? String(event.over.id) : null
          if (
            !status ||
            saving ||
            epics.find((epic) => epic.epic.id === id)?.epic.status === status
          )
            return
          setSaving(true)
          setError(null)
          try {
            await onStatusChange(id, status)
          } catch (error) {
            setError(String(error))
          } finally {
            setSaving(false)
          }
        }}
        onDragCancel={() => {
          dragged.current = false
        }}
      >
        <div className="flex gap-3 overflow-x-auto p-4">
          {statuses.map((status) => (
            <Column key={status} status={status}>
              {epics
                .filter((epic) => epic.epic.status === status)
                .map((epic) => (
                  <Card
                    key={epic.epic.id}
                    epic={epic}
                    disabled={saving}
                    onSelect={() => {
                      if (!dragged.current) onSelect(epic.epic.id)
                    }}
                  />
                ))}
            </Column>
          ))}
        </div>
      </DndContext>
    </>
  )
}
function Column({
  status,
  children,
}: {
  status: string
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <section
      ref={setNodeRef}
      data-board-column={status}
      className={`min-h-40 w-80 shrink-0 rounded-lg bg-muted/40 p-3 ${isOver ? 'ring-1 ring-ring' : ''}`}
    >
      <h2 className="mb-3 flex items-center gap-2">
        <StatusIcon status={status} />
        {statusLabel(status)}
      </h2>
      {children}
    </section>
  )
}
function Card({
  epic,
  disabled,
  onSelect,
}: {
  epic: EpicStatus
  disabled: boolean
  onSelect: () => void
}) {
  const { setNodeRef, listeners, attributes, transform } = useDraggable({
    id: epic.epic.id,
    disabled,
  })
  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onSelect}
      disabled={disabled}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className="mb-2 flex w-full flex-wrap items-center gap-2 rounded-md border bg-background p-3 text-left"
    >
      <ProjectFields epic={epic} />
    </button>
  )
}
