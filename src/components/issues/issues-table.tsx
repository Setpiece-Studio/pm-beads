// ABOUTME: Linear-style issues table — TanStack Table row/column model rendered under
// ABOUTME: collapsible group header rows, with display-property column visibility.

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type Row,
  useReactTable,
} from '@tanstack/react-table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { buildBlockedIds } from '@/lib/beads/blocked'
import type { Issue } from '@/lib/beads/types'
import {
  BlockedIndicator,
  EpicChip,
  PriorityIcon,
  StatusIcon,
  shortDate,
  statusLabel,
} from '@/lib/issue-meta'
import { cn } from '@/lib/utils'
import {
  buildGroups,
  DEFAULT_DISPLAY_PROPERTIES,
  type DisplayProperty,
  type ViewOptions,
} from './grouping'
import { LabelStack } from './label-stack'

/**
 * Per-column presentation. `width` becomes a `<col>` track under the table's fixed layout;
 * the title column deliberately omits it so it is the one auto track and absorbs all the
 * slack. Under `table-auto` the metadata columns claimed their widest row's intrinsic width
 * and the title collapsed to nothing, so every column but the title is pinned here.
 */
interface ColumnMeta {
  className?: string
  width?: string
}

function columnMeta(meta: unknown): ColumnMeta {
  return (meta ?? {}) as ColumnMeta
}

interface IssuesTableProps {
  issues: Issue[]
  epicNames: Record<string, string>
  options: ViewOptions
  displayProperties?: ReadonlySet<DisplayProperty>
  onRowClick: (id: string) => void
}

const columnHelper = createColumnHelper<Issue>()

export function IssuesTable({
  issues,
  epicNames,
  options,
  displayProperties = DEFAULT_DISPLAY_PROPERTIES,
  onRowClick,
}: IssuesTableProps) {
  const groups = useMemo(
    () => buildGroups(issues, options, epicNames),
    [issues, options, epicNames],
  )
  // Edge-derived blocked set: an issue has an unresolved blocker when a blocks edge points at a
  // non-closed issue present in the loaded set (R11). Built once from the same issues array.
  const blockedIds = useMemo(() => buildBlockedIds(issues), [issues])
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const columns = useMemo(
    () => [
      columnHelper.accessor('priority', {
        id: 'priority',
        cell: ({ getValue }) => <PriorityIcon priority={getValue()} />,
        meta: { className: 'pl-4', width: '2.5rem' },
      }),
      columnHelper.accessor('id', {
        id: 'id',
        cell: ({ getValue }) => (
          <span className="block truncate text-muted-foreground">
            {getValue()}
          </span>
        ),
        meta: { width: '7.5rem' },
      }),
      columnHelper.accessor('status', {
        id: 'status',
        cell: ({ getValue, row }) => (
          <span className="flex items-center gap-1">
            {blockedIds.has(row.original.id) ? <BlockedIndicator /> : null}
            <StatusIcon
              status={getValue()}
              aria-label={statusLabel(getValue())}
            />
          </span>
        ),
        meta: { width: '3rem' },
      }),
      // The only track without a width: fixed layout hands it everything the pinned
      // columns leave over, and the cell truncates rather than widening the table.
      columnHelper.accessor('title', {
        id: 'title',
        cell: ({ getValue }) => (
          <span className="block truncate font-medium text-foreground">
            {getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('labels', {
        id: 'labels',
        cell: ({ getValue }) => {
          const labels = getValue()
          if (!labels?.length) return null
          return <LabelStack labels={labels} />
        },
        meta: { className: 'text-right', width: '11rem' },
      }),
      columnHelper.accessor('parent', {
        id: 'project',
        cell: ({ getValue }) => {
          const parent = getValue()
          if (!parent) return null
          return <EpicChip name={epicNames[parent] ?? parent} />
        },
        meta: { className: 'text-right', width: '13rem' },
      }),
      columnHelper.accessor('created_at', {
        id: 'created',
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {shortDate(getValue())}
          </span>
        ),
        meta: { className: 'text-right', width: '5.5rem' },
      }),
      columnHelper.accessor('updated_at', {
        id: 'updated',
        cell: ({ getValue }) => (
          <span className="text-xs text-muted-foreground">
            {shortDate(getValue())}
          </span>
        ),
        meta: { className: 'pr-4 text-right', width: '6rem' },
      }),
    ],
    [epicNames, blockedIds],
  )

  // Title is always shown; the rest follow the display-property toggles.
  const columnVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = { title: true }
    for (const id of [
      'priority',
      'id',
      'status',
      'labels',
      'project',
      'created',
      'updated',
    ] as const) {
      visibility[id] = displayProperties.has(id)
    }
    return visibility
  }, [displayProperties])

  // One table model over every visible issue; groups index into it by row id.
  const flatIssues = useMemo(() => {
    const seen = new Set<string>()
    const flat: Issue[] = []
    for (const group of groups) {
      for (const issue of group.issues) {
        if (!seen.has(issue.id)) {
          seen.add(issue.id)
          flat.push(issue)
        }
      }
    }
    return flat
  }, [groups])

  const table = useReactTable({
    data: flatIssues,
    columns,
    state: { columnVisibility },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  })
  // The TanStack table reference is stable, so memoizing on it avoids reallocating this lookup
  // map every render while still rebuilding it when the row model actually changes.
  // Rebuilt each render: getRowModel() reflects data/grouping/sort/filter changes,
  // and a stable [table] memo dep would go stale on a project switch (new issues).
  const rowsById = new Map<string, Row<Issue>>(
    table.getRowModel().rows.map((row) => [row.id, row]),
  )
  const visibleColumns = table.getVisibleLeafColumns()
  const visibleColumnCount = visibleColumns.length

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <div className="p-8 text-center text-[13px] text-muted-foreground">
        No issues match the current filters
      </div>
    )
  }

  return (
    // Fixed layout + an explicit track per column: the group header rows span every column,
    // so without the colgroup the fixed algorithm would size the tracks off that one cell.
    <Table className="table-fixed text-[13px]">
      <colgroup>
        {visibleColumns.map((column) => (
          <col
            key={column.id}
            style={{ width: columnMeta(column.columnDef.meta).width }}
          />
        ))}
      </colgroup>
      <TableBody>
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.key)
          return (
            <GroupRows
              key={group.key}
              group={group}
              isCollapsed={isCollapsed}
              columnCount={visibleColumnCount}
              rowsById={rowsById}
              onToggle={() => toggleGroup(group.key)}
              onRowClick={onRowClick}
            />
          )
        })}
      </TableBody>
    </Table>
  )
}

function GroupRows({
  group,
  isCollapsed,
  columnCount,
  rowsById,
  onToggle,
  onRowClick,
}: {
  group: ReturnType<typeof buildGroups>[number]
  isCollapsed: boolean
  columnCount: number
  rowsById: Map<string, Row<Issue>>
  onToggle: () => void
  onRowClick: (id: string) => void
}) {
  const Chevron = isCollapsed ? ChevronRight : ChevronDown
  return (
    <>
      <TableRow className="border-0 bg-muted/40 hover:bg-muted/60">
        <TableCell colSpan={columnCount} className="p-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!isCollapsed}
            className="group flex h-8 w-full items-center gap-2 px-4 text-left"
          >
            <Chevron className="size-3.5 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
            {group.status ? <StatusIcon status={group.status} /> : null}
            <span className="font-medium">{group.label}</span>
            <span className="text-xs text-muted-foreground">
              {group.issues.length}
            </span>
          </button>
        </TableCell>
      </TableRow>
      {isCollapsed
        ? null
        : group.issues.map((issue) => {
            const row = rowsById.get(issue.id)
            if (!row) return null
            return (
              <TableRow
                key={`${group.key}:${issue.id}`}
                onClick={() => onRowClick(issue.id)}
                className="h-9 cursor-pointer border-0 hover:bg-accent/60"
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    data-column={cell.column.id}
                    className={cn(
                      'py-1.5',
                      columnMeta(cell.column.columnDef.meta).className,
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
    </>
  )
}
