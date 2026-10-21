// ABOUTME: Linear-style filter bar — an add-filter menu (property list drilling into checkbox
// ABOUTME: value flyouts) plus compound chips with operator and multi-select value flyouts.

import {
  Box,
  Check,
  ChevronRight,
  CircleDot,
  CircleUser,
  ListFilter,
  type LucideIcon,
  Plus,
  Shapes,
  SignalHigh,
  Tag,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { labelColorClass, PriorityIcon, StatusIcon } from '@/lib/issue-meta'
import { cn } from '@/lib/utils'
import {
  type ActiveFilter,
  FILTER_PROPERTY_LABELS,
  type FilterOperator,
  type FilterProperty,
  type FilterValueOption,
  NONE_VALUE,
  operatorLabel,
  removeFilter,
  setFilterOperator,
  toggleFilterValue,
  valueSummary,
} from './filters'

const PROPERTY_ICONS: Record<FilterProperty, LucideIcon> = {
  status: CircleDot,
  type: Shapes,
  priority: SignalHigh,
  assignee: CircleUser,
  label: Tag,
  project: Box,
}

interface FilterBarProps {
  // The properties this view filters on, in menu order.
  properties: readonly FilterProperty[]
  filters: ActiveFilter[]
  valueOptions: Partial<Record<FilterProperty, FilterValueOption[]>>
  onChange: (filters: ActiveFilter[]) => void
}

export function FilterBar({
  properties,
  filters,
  valueOptions,
  onChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <FilterChip
          key={filter.property}
          filter={filter}
          options={valueOptions[filter.property] ?? []}
          filters={filters}
          onChange={onChange}
        />
      ))}
      <AddFilterMenu
        properties={properties}
        filters={filters}
        valueOptions={valueOptions}
        onChange={onChange}
      >
        {filters.length === 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <ListFilter className="size-3.5" />
            Filter
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Add filter"
            className="size-7 p-0 text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </AddFilterMenu>
    </div>
  )
}

// Property list drilling into a value flyout; stays open so several values can be checked.
function AddFilterMenu({
  properties,
  filters,
  valueOptions,
  onChange,
  children,
}: FilterBarProps & { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<FilterProperty | null>(null)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setPage(null)
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0 text-[13px]">
        {page === null ? (
          <Command>
            <CommandInput placeholder="Add filter..." />
            <CommandList>
              <CommandEmpty>No matches</CommandEmpty>
              {properties.map((property) => {
                const Icon = PROPERTY_ICONS[property]
                return (
                  <CommandItem
                    key={property}
                    value={FILTER_PROPERTY_LABELS[property]}
                    onSelect={() => setPage(property)}
                  >
                    <Icon className="size-3.5 text-muted-foreground" />
                    {FILTER_PROPERTY_LABELS[property]}
                    <ChevronRight className="ml-auto size-3.5 text-muted-foreground/60" />
                  </CommandItem>
                )
              })}
            </CommandList>
          </Command>
        ) : (
          <ValueList
            property={page}
            options={valueOptions[page] ?? []}
            filters={filters}
            onChange={onChange}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

// Checkbox multi-select list of a property's values, shared by the add-filter menu
// and the chip's values flyout.
function ValueList({
  property,
  options,
  filters,
  onChange,
}: {
  property: FilterProperty
  options: FilterValueOption[]
  filters: ActiveFilter[]
  onChange: (filters: ActiveFilter[]) => void
}) {
  const checked = new Set(
    filters.find((f) => f.property === property)?.values ?? [],
  )
  return (
    <Command>
      <CommandInput placeholder={FILTER_PROPERTY_LABELS[property]} />
      <CommandList>
        <CommandEmpty>No matches</CommandEmpty>
        {options.map((option) => {
          const isChecked = checked.has(option.value)
          return (
            <CommandItem
              key={option.value}
              value={option.label}
              aria-checked={isChecked}
              onSelect={() =>
                onChange(toggleFilterValue(filters, property, option.value))
              }
            >
              <span
                className={cn(
                  'flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border',
                  isChecked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border',
                )}
              >
                {isChecked ? <Check className="size-3" /> : null}
              </span>
              <ValueGlyph property={property} value={option.value} />
              {option.label}
            </CommandItem>
          )
        })}
      </CommandList>
    </Command>
  )
}

function ValueGlyph({
  property,
  value,
}: {
  property: FilterProperty
  value: string
}) {
  switch (property) {
    case 'status':
      return value === NONE_VALUE ? null : <StatusIcon status={value} />
    case 'priority':
      return <PriorityIcon priority={Number(value)} />
    case 'label':
      return (
        <span
          aria-hidden="true"
          className={cn(
            'size-2 shrink-0 rounded-full',
            value === NONE_VALUE
              ? 'bg-muted-foreground/40'
              : labelColorClass(value),
          )}
        />
      )
    case 'project':
      return <Box className="size-3.5 shrink-0 text-muted-foreground" />
    case 'assignee':
      return <CircleUser className="size-3.5 shrink-0 text-muted-foreground" />
    case 'type':
      return null
  }
}

// Compound chip: [icon + property] [operator ▾] [values summary ▾] [×], each segment
// separated by a hairline border, the middle two opening flyouts.
function FilterChip({
  filter,
  options,
  filters,
  onChange,
}: {
  filter: ActiveFilter
  options: FilterValueOption[]
  filters: ActiveFilter[]
  onChange: (filters: ActiveFilter[]) => void
}) {
  const [operatorOpen, setOperatorOpen] = useState(false)
  const label = FILTER_PROPERTY_LABELS[filter.property]
  const Icon = PROPERTY_ICONS[filter.property]
  return (
    <div className="flex h-7 items-stretch overflow-hidden rounded-md border text-xs">
      <span className="flex items-center gap-1.5 border-r px-2 text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      <Popover open={operatorOpen} onOpenChange={setOperatorOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} operator`}
            className="border-r px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {operatorLabel(filter.operator, filter.values.length)}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-36 p-0 text-[13px]">
          <Command>
            <CommandList>
              {(['is', 'is-not'] as const).map((op: FilterOperator) => (
                <CommandItem
                  key={op}
                  value={op === 'is' ? 'is' : 'is not'}
                  onSelect={() => {
                    onChange(setFilterOperator(filters, filter.property, op))
                    setOperatorOpen(false)
                  }}
                >
                  {operatorLabel(op, filter.values.length)}
                  {filter.operator === op ? (
                    <Check className="ml-auto size-3.5" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label} values`}
            className="border-r px-2 transition-colors hover:bg-accent"
          >
            {valueSummary(filter, options)}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-0 text-[13px]">
          <ValueList
            property={filter.property}
            options={options}
            filters={filters}
            onChange={onChange}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={`Remove ${label} filter`}
        onClick={() => onChange(removeFilter(filters, filter.property))}
        className="px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
