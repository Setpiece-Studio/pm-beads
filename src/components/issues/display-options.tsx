// ABOUTME: Linear-style display-options popover — a sliders button opening grouping and
// ABOUTME: ordering selects plus pill toggles for which row properties (columns) are visible.

import { LayoutGrid, List, SlidersHorizontal } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { ViewMode } from './board-logic'
import {
  DISPLAY_PROPERTIES,
  DISPLAY_PROPERTY_LABELS,
  type DisplayProperty,
  type GroupingKey,
  type OrderingKey,
  toggleDisplayProperty,
} from './grouping'

const GROUPINGS: { value: GroupingKey; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'project', label: 'Project' },
  { value: 'label', label: 'Label' },
  { value: 'none', label: 'No grouping' },
]

const ORDERINGS: { value: OrderingKey; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'updated', label: 'Last updated' },
]

const VIEW_MODES: { value: ViewMode; label: string; icon: typeof List }[] = [
  { value: 'list', label: 'List', icon: List },
  { value: 'board', label: 'Board', icon: LayoutGrid },
]

export interface DisplayOptionsPatch {
  view?: ViewMode
  grouping?: GroupingKey
  ordering?: OrderingKey
  displayProperties?: ReadonlySet<DisplayProperty>
}

interface DisplayOptionsProps {
  view: ViewMode
  grouping: GroupingKey
  ordering: OrderingKey
  displayProperties: ReadonlySet<DisplayProperty>
  onChange: (patch: DisplayOptionsPatch) => void
}

export function DisplayOptions({
  view,
  grouping,
  ordering,
  displayProperties,
  onChange,
}: DisplayOptionsProps) {
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
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {VIEW_MODES.map(({ value, label, icon: Icon }) => {
              const active = view === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange({ view: value })}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              )
            })}
          </div>
          <OptionRow label="Grouping">
            <Select
              value={grouping}
              onValueChange={(v) => onChange({ grouping: v as GroupingKey })}
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
              onValueChange={(v) => onChange({ ordering: v as OrderingKey })}
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
        </div>
        <Separator />
        <div className="flex flex-col gap-2 p-3">
          <span className="text-xs text-muted-foreground">
            Display properties
          </span>
          <div className="flex flex-wrap gap-1.5">
            {DISPLAY_PROPERTIES.map((property) => {
              const active = displayProperties.has(property)
              return (
                <button
                  key={property}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    onChange({
                      displayProperties: toggleDisplayProperty(
                        displayProperties,
                        property,
                      ),
                    })
                  }
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-xs transition-colors',
                    active
                      ? 'border-border bg-secondary text-secondary-foreground'
                      : 'border-transparent bg-transparent text-muted-foreground hover:border-border/60 hover:text-foreground',
                  )}
                >
                  {DISPLAY_PROPERTY_LABELS[property]}
                </button>
              )
            })}
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
