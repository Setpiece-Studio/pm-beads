// ABOUTME: Memories list table — simple key + preview rows, sorted by the data layer.

import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import type { Memory } from '@/lib/beads/types'

interface MemoriesTableProps {
  memories: Memory[]
  onRowClick: (key: string) => void
}

export function MemoriesTable({ memories, onRowClick }: MemoriesTableProps) {
  if (memories.length === 0) {
    return (
      <div className="p-8 text-center text-[13px] text-muted-foreground">
        No memories found
      </div>
    )
  }

  return (
    <Table className="text-[13px]">
      <TableBody>
        {memories.map((memory) => (
          <TableRow
            key={memory.key}
            onClick={() => onRowClick(memory.key)}
            className="h-10 cursor-pointer border-0 hover:bg-accent/60"
          >
            <TableCell className="w-72 py-1.5 pl-4 align-top">
              <span className="block truncate font-medium text-foreground">
                {memory.key}
              </span>
            </TableCell>
            <TableCell className="max-w-0 py-1.5 pr-4 align-top">
              <span className="block truncate text-muted-foreground">
                {memory.value}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
