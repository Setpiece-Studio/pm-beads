// ABOUTME: Inline chip a bead reference in markdown renders as — the bead's title and status
// ABOUTME: glyph (id on hover), linking to /issues/$id (or /projects/$id for an epic) with ?project=.

import { Link } from '@tanstack/react-router'
import type { MouseEvent } from 'react'
import { useBeadLookup } from '@/lib/bead-lookup'
import { beadRefTitle, StatusIcon, statusLabel } from '@/lib/issue-meta'
import { cn } from '@/lib/utils'

export interface BeadChipProps {
  /** The bead id, lowercased by the tokenizer. */
  id: string
  /** The reference itself said this is an epic (a `/projects/` url). Otherwise the lookup
   * decides — and a bead outside the loaded set is treated as an ordinary issue. */
  epic?: boolean
  className?: string
}

const CHIP_CLASS =
  'inline-flex items-center gap-1 rounded border border-border/70 bg-muted/50 px-1 align-baseline text-[0.9em] leading-tight text-foreground no-underline hover:bg-accent'

/**
 * A bead reference, rendered. An epic's canonical home is the project route, not the issue
 * route (KTD12), so epics link straight there rather than bouncing through a redirect.
 *
 * The chip sits inside prose, so it reads as the bead's title and nothing else; the id is
 * hover text (`title`). A bead the route did not load has no title to lead with, so the id
 * is the label there — set in mono, since it is then an identifier rather than a name.
 *
 * When the lookup provides `onOpenBead` the chip stays an anchor — href and all, so
 * middle-click and "open in new tab" behave — but a plain left click is intercepted: the inbox
 * opens its drawer instead of navigating away from the conversation.
 */
export function BeadChip({ id, epic, className }: BeadChipProps) {
  const lookup = useBeadLookup()
  const status = lookup?.statusOf(id)
  const title = lookup?.titleOf(id)
  const isEpic = epic === true || (lookup?.isEpic(id) ?? false)
  const project = lookup?.project
  const onOpenBead = lookup?.onOpenBead
  const label = title?.trim() === '' ? undefined : title

  const body = (
    <>
      {status !== undefined && (
        <>
          <StatusIcon status={status} className="size-3" />
          <span className="sr-only">{statusLabel(status)}</span>
        </>
      )}
      {label ?? id}
    </>
  )

  const shared = {
    'data-bead-chip': id,
    title: beadRefTitle(id, title),
    className: cn(CHIP_CLASS, label === undefined && 'font-mono', className),
  }

  if (onOpenBead !== undefined) {
    return (
      <a
        {...shared}
        href={openHref(id, isEpic, project)}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          // Only a plain left click is ours; let the browser have the rest.
          if (isModifiedClick(event)) return
          event.preventDefault()
          onOpenBead(id)
        }}
      >
        {body}
      </a>
    )
  }

  return isEpic ? (
    <Link
      {...shared}
      to="/projects/$projectId"
      params={{ projectId: id }}
      search={{ project }}
    >
      {body}
    </Link>
  ) : (
    <Link
      {...shared}
      to="/issues/$issueId"
      params={{ issueId: id }}
      search={{ project }}
    >
      {body}
    </Link>
  )
}

/** The same url the Link form produces, built by hand: the interception branch is a plain
 * anchor, so it has no router to ask. */
function openHref(id: string, isEpic: boolean, project?: string): string {
  const path = `${isEpic ? '/projects/' : '/issues/'}${id}`
  if (project === undefined) return path
  return `${path}?${new URLSearchParams({ project }).toString()}`
}

function isModifiedClick(event: MouseEvent): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
}
