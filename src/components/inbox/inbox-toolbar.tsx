// ABOUTME: Open-ask inbox header with a bead count and chronological sort.
import { ArrowDownUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { InboxSort } from './inbox-model'

export function InboxToolbar({
  count,
  sort,
  onChange,
}: {
  count: number
  sort: InboxSort
  onChange: (patch: { sort: InboxSort }) => void
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2.5">
      <h1 className="text-sm font-semibold">Inbox</h1>
      <span className="text-xs text-muted-foreground">
        {count} with open asks
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Sort"
            className="ml-auto text-muted-foreground"
          >
            <ArrowDownUp className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-44 p-1 text-[13px]">
          {(['newest', 'oldest'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={sort === value}
              onClick={() => onChange({ sort: value })}
              className="flex w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            >
              {value === 'newest' ? 'Newest first' : 'Oldest first'}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  )
}
