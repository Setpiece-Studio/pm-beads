// ABOUTME: "Add section" control on the issue body — offers the optional bd long-text fields that
// ABOUTME: are still empty, so they are reachable without leaving three permanent stubs on show.

import { Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LONG_TEXT_LABELS, type LongTextField } from './long-text-section'

export interface AddSectionMenuProps {
  /** Optional fields with nothing in them and not already open for editing. */
  available: readonly LongTextField[]
  onAdd: (field: LongTextField) => void
}

export function AddSectionMenu({ available, onAdd }: AddSectionMenuProps) {
  // Nothing left to add is the common case on a fully-written issue; the control disappears
  // rather than sitting there disabled.
  if (available.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="add-section"
          className="flex items-center gap-1 self-start rounded-md px-1 py-0.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add section
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="min-w-40"
        // Radix returns focus to the trigger when the menu closes, which lands AFTER the section
        // it just opened has autofocused its editor. That reads as the reader leaving an
        // untouched editor, so the section commits nothing and is abandoned the instant it
        // appears. Focus is going somewhere deliberate here, so the restore is suppressed.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {available.map((field) => (
          <DropdownMenuItem key={field} onSelect={() => onAdd(field)}>
            {LONG_TEXT_LABELS[field]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
