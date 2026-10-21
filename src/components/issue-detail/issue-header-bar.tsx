// ABOUTME: The h-10 bar every pane showing one bead wears — leading crumbs, the bead's title and
// ABOUTME: mono id, star and overflow affordances, and a caller-supplied cluster on the right.

import { MoreHorizontal, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BeadId, beadRefTitle } from '@/lib/issue-meta'
import { cn } from '@/lib/utils'

export interface IssueHeaderBarProps {
  /** The bead's id, trailing the title as secondary text. Absent where the pane is about a
   * bead it cannot name — a message thread with no related bead — rather than faked. */
  id?: string
  /** The bead's name. Truncates before anything else in the bar does. */
  title: string
  /** What the star and overflow labels call this thing — "issue", "project", "notification". */
  noun: string
  /** Rendered ahead of the title: the issue detail's breadcrumb crumbs, nothing in the inbox. */
  leading?: ReactNode
  /** Replaces the bare title text with a link, a button, or whatever the host wants clickable.
   * The truncation and the hover text stay with the bar either way. */
  titleContent?: ReactNode
  /** Renders the title cell as a heading. The inbox needs one — the pane has no other title —
   * while the issue detail's own h1 is in the body below. */
  titleAsHeading?: boolean
  /** Items for the overflow menu. Without any, the button renders inert: it is a placeholder
   * for the menu Linear puts here, and the issue detail has not grown one yet. */
  overflow?: ReactNode
  /** Names the left cluster as a landmark. Set where the crumbs make it a breadcrumb nav. */
  navLabel?: string
  /** The right-hand cluster — the detail's n/N arrows, the inbox's notification actions. */
  children?: ReactNode
  /** Extra classes on the bar itself, for hosts whose chrome needs clearing (the drawer's
   * close button sits over the bar's right edge). */
  className?: string
}

export function IssueHeaderBar({
  id,
  title,
  noun,
  leading,
  titleContent,
  titleAsHeading = false,
  overflow,
  navLabel,
  children,
  className,
}: IssueHeaderBarProps) {
  const Left = navLabel ? 'nav' : 'div'
  const Title = titleAsHeading ? 'h2' : 'span'
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center gap-2 overflow-hidden border-b px-4',
        className,
      )}
    >
      <Left
        aria-label={navLabel}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]"
      >
        {leading}
        {/* The title is what tells you where you are, and it is the one that may truncate; the
            id trails it as secondary text. */}
        <Title
          className={cn(
            'min-w-0 truncate',
            // A heading is the pane's own title and carries the weight; a crumb sits at the
            // end of a trail whose first crumb is already the bold one.
            titleAsHeading && 'text-[13px] font-medium',
          )}
          title={id ? beadRefTitle(id, title) : title}
        >
          {titleContent ?? title}
        </Title>
        {id && <BeadId id={id} />}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Star this ${noun}`}
          className="ml-1 shrink-0 text-muted-foreground"
        >
          <Star />
        </Button>
        {overflow ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`More ${noun} actions`}
                className="shrink-0 text-muted-foreground"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-44">
              {overflow}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`More ${noun} actions`}
            className="shrink-0 text-muted-foreground"
          >
            <MoreHorizontal />
          </Button>
        )}
      </Left>

      {children !== undefined && (
        <div className="flex shrink-0 items-center gap-1">{children}</div>
      )}
    </header>
  )
}
