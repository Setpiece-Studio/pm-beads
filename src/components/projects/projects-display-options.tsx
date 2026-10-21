// ABOUTME: Linear-style display-options popover for the projects view — grouping and ordering
// ABOUTME: selects over epics, including the beads-native blocking (dependency) order.

import { SlidersHorizontal } from 'lucide-react'
import { useContext } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  PROJECT_PROPERTIES,
  ProjectPropertiesContext,
  serializeProjectProperties,
} from './project-properties'
import type {
  ProjectGroupingKey,
  ProjectOrderingKey,
  ProjectViewMode,
} from './projects-model'

const VIEWS: { value: ProjectViewMode; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'board', label: 'Board' },
  { value: 'tree', label: 'Hierarchy' },
]

const GROUPINGS: { value: ProjectGroupingKey; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'none', label: 'No grouping' },
]

const ORDERINGS: { value: ProjectOrderingKey; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'updated', label: 'Last updated' },
  { value: 'created', label: 'Created' },
  { value: 'progress', label: 'Progress' },
  { value: 'child-count', label: 'Child count' },
  { value: 'title', label: 'Title' },
  { value: 'blocking', label: 'Blocking order' },
]

export interface ProjectsDisplayOptionsPatch {
  display?: string
  view?: ProjectViewMode
  grouping?: ProjectGroupingKey
  ordering?: ProjectOrderingKey
}

interface ProjectsDisplayOptionsProps {
  view: ProjectViewMode
  grouping: ProjectGroupingKey
  ordering: ProjectOrderingKey
  onChange: (patch: ProjectsDisplayOptionsPatch) => void
}

export function ProjectsDisplayOptions({
  view,
  grouping,
  ordering,
  onChange,
}: ProjectsDisplayOptionsProps) {
  const { properties } = useContext(ProjectPropertiesContext)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <SlidersHorizontal className="size-3.5" />
          Display
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 text-[13px]">
        <div className="flex flex-col gap-2.5 p-3">
          <OptionRow label="View">
            <Select
              value={view}
              onValueChange={(v) => onChange({ view: v as ProjectViewMode })}
            >
              <SelectTrigger
                size="sm"
                aria-label="View"
                className="h-7 w-32 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIEWS.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </OptionRow>
          {view !== 'tree' && (
            <>
              <OptionRow label="Grouping">
                <Select
                  value={grouping}
                  onValueChange={(v) =>
                    onChange({ grouping: v as ProjectGroupingKey })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Grouping"
                    className="h-7 w-32 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GROUPINGS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </OptionRow>
              <OptionRow label="Ordering">
                <Select
                  value={ordering}
                  onValueChange={(v) =>
                    onChange({ ordering: v as ProjectOrderingKey })
                  }
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Ordering"
                    className="h-7 w-32 text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDERINGS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </OptionRow>
            </>
          )}
        </div>
        <div className="border-t p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Display properties
          </p>
          <div className="flex flex-wrap gap-1.5">
            {PROJECT_PROPERTIES.map((property) => (
              <button
                type="button"
                key={property}
                aria-pressed={properties.has(property)}
                className="rounded-md border px-2 py-0.5 text-xs aria-pressed:bg-secondary"
                onClick={() => {
                  const next = new Set(properties)
                  if (next.has(property)) next.delete(property)
                  else next.add(property)
                  onChange({ display: serializeProjectProperties(next) })
                }}
              >
                {(
                  {
                    'child-count': 'Child count',
                    project: 'Parent project',
                    id: 'ID',
                  } as Record<string, string>
                )[property] ?? property[0].toUpperCase() + property.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function OptionRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
