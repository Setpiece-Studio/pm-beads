// ABOUTME: Timeline row presentation for the activity stream — the typed glyph and sentence for
// ABOUTME: each derived history event, and the comment card.

import { MoreHorizontal, PenLine } from 'lucide-react'
import type { ReactNode } from 'react'
import { Markdown } from '@/components/ui/markdown'
import type { ActivityEvent, TextField } from '@/lib/beads/activity'
import { acknowledgedCommentId, messageKind } from '@/lib/beads/messages'
import type { Comment, Message } from '@/lib/beads/types'
import { commentAnchorId } from '@/lib/comment-refs'
import {
  PriorityIcon,
  priorityLabel,
  relativeTime,
  StatusIcon,
  statusLabel,
  TypeIcon,
  typeLabel,
} from '@/lib/issue-meta'
import { cn } from '@/lib/utils'

/** Up to two initials from a display name; an email or single word yields one. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const letters = words.slice(0, 2).map((word) => word[0] ?? '')
  return letters.join('').toUpperCase()
}

/** Initials disc sitting on the timeline's thin line. Without an actor it renders the neutral
 * marker used for events bd cannot attribute to a person (its history records only the dolt
 * committer, never the human who ran the command). */
export function ActorAvatar({
  actor,
  className,
}: {
  actor?: string
  className?: string
}) {
  if (!actor) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5 items-center justify-center rounded-full bg-background',
          className,
        )}
      >
        <span className="size-2 rounded-full border border-muted-foreground/60" />
      </span>
    )
  }
  return (
    <span
      title={actor}
      className={cn(
        'flex size-5 select-none items-center justify-center rounded-full bg-muted text-[9px] font-medium leading-none text-muted-foreground',
        className,
      )}
    >
      {initials(actor)}
    </span>
  )
}

/** The 20px optical column every timeline glyph shares, so a 14px icon and the initials disc
 * sit on one centerline and the rail behind them stays straight. The opaque background is what
 * lets the line pass underneath without showing through the glyph. */
function GlyphSlot({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-5 items-center justify-center rounded-full bg-background',
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * The glyph for one history event. Color here is never decoration: it comes from the same
 * status/priority/type icons the rest of the app uses, so a red or an amber dot in the feed
 * means exactly what it means in a list row. Events that only a person can be the subject of
 * keep the initials disc, and a rename or a body edit — where nothing semantic moved — gets a
 * muted pen.
 */
export function EventGlyph({
  event,
  className,
}: {
  event: ActivityEvent
  className?: string
}) {
  switch (event.kind) {
    case 'created':
    case 'assigned':
    case 'unassigned':
      return <ActorAvatar actor={event.actor} className={className} />
    case 'status':
    case 'reopened':
      return (
        <GlyphSlot className={className}>
          <StatusIcon status={event.to} />
        </GlyphSlot>
      )
    case 'closed':
      return (
        <GlyphSlot className={className}>
          <StatusIcon status="closed" />
        </GlyphSlot>
      )
    case 'priority':
      return (
        <GlyphSlot className={className}>
          <PriorityIcon priority={event.to} />
        </GlyphSlot>
      )
    case 'type':
      return (
        <GlyphSlot className={className}>
          <TypeIcon type={event.to} />
        </GlyphSlot>
      )
    case 'renamed':
    case 'edited':
      return (
        <GlyphSlot className={className}>
          <PenLine className="size-3.5 shrink-0 text-muted-foreground" />
        </GlyphSlot>
      )
  }
}

const TEXT_FIELD_LABELS: Record<TextField, string> = {
  description: 'Description',
  notes: 'Notes',
  design: 'Design',
  acceptance_criteria: 'Acceptance criteria',
}

/** How far along the workflow a status sits — used only to choose "moved" over "moved back".
 * Deliberately not STATUS_ORDER, which is a reading order for lists (in progress first) rather
 * than a progression: a regression is the one status change worth calling out as one. */
const STATUS_PROGRESS = [
  'deferred',
  'open',
  'blocked',
  'in_progress',
  'closed',
] as const

function statusProgress(status: string): number {
  const index = STATUS_PROGRESS.indexOf(
    status as (typeof STATUS_PROGRESS)[number],
  )
  return index === -1 ? STATUS_PROGRESS.length : index
}

/** The event sentence. Events bd can attribute lead with the actor and read as something a
 * person did; the rest name the field that changed, so no change is silently credited to the
 * wrong person (bd history records only the dolt committer, never the human who ran the
 * command, so most events arrive with no actor at all). */
export function eventSentence(event: ActivityEvent): string {
  const actor = event.actor
  switch (event.kind) {
    case 'created':
      return actor ? `${actor} created the issue` : 'Issue created'
    case 'status': {
      const from = statusLabel(event.from)
      const to = statusLabel(event.to)
      if (!actor) return `Status changed from ${from} to ${to}`
      const verb =
        statusProgress(event.to) < statusProgress(event.from)
          ? 'moved back'
          : 'moved'
      return `${actor} ${verb} from ${from} to ${to}`
    }
    case 'closed':
      if (actor)
        return event.reason
          ? `${actor} closed this as ${event.reason}`
          : `${actor} closed this`
      return event.reason ? `Closed as ${event.reason}` : 'Issue closed'
    case 'reopened':
      return actor
        ? `${actor} reopened this as ${statusLabel(event.to)}`
        : `Reopened as ${statusLabel(event.to)}`
    case 'assigned':
      if (event.self) return `${event.to} self-assigned`
      return actor
        ? `${actor} assigned this to ${event.to}`
        : `Assigned to ${event.to}`
    case 'unassigned':
      if (actor && event.from) return `${actor} unassigned ${event.from}`
      return event.from ? `Unassigned from ${event.from}` : 'Unassigned'
    case 'priority': {
      const change = `from ${priorityLabel(event.from)} to ${priorityLabel(event.to)}`
      return actor
        ? `${actor} changed priority ${change}`
        : `Priority changed ${change}`
    }
    case 'renamed':
      return actor
        ? `${actor} renamed this to “${event.to}”`
        : `Renamed to “${event.to}”`
    case 'type': {
      const change = `from ${typeLabel(event.from)} to ${typeLabel(event.to)}`
      return actor
        ? `${actor} changed type ${change}`
        : `Type changed ${change}`
    }
    case 'edited':
      return actor
        ? `${actor} edited the ${TEXT_FIELD_LABELS[event.field].toLowerCase()}`
        : `${TEXT_FIELD_LABELS[event.field]} edited`
  }
}

export function EventRow({ event }: { event: ActivityEvent }) {
  return (
    <div className="flex min-h-6 items-center gap-2.5 text-xs text-muted-foreground">
      <span>{eventSentence(event)}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={event.at}>{relativeTime(event.at)}</time>
    </div>
  )
}

/** The card body's left inset — clearing the header avatar (20px) and the gap after it (8px)
 * so the text starts under the author's name rather than under their disc. */
const CARD_BODY_INSET = 'pl-10'

export function CommentCard({ comment }: { comment: Comment }) {
  return (
    <article className="group rounded-md border bg-card">
      <header className="flex items-center gap-2 px-3 pt-2.5">
        <ActorAvatar actor={comment.author} className="shrink-0" />
        <span className="text-xs font-medium">{comment.author}</span>
        <time
          dateTime={comment.created_at}
          className="text-xs text-muted-foreground"
        >
          {relativeTime(comment.created_at)}
        </time>
        {/* Placeholder for the per-comment menu Linear puts here (edit/delete/copy link);
            bd exposes no comment mutations beyond add, so it stays inert for now. It is
            revealed on hover or focus rather than drawn permanently: a disabled button on
            every card in the feed is noise on every card in the feed. */}
        <button
          type="button"
          disabled
          aria-label="Comment actions"
          className="ml-auto rounded p-0.5 text-muted-foreground/70 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </header>
      <Markdown className={cn('px-3 pb-2.5 text-[13px]', CARD_BODY_INSET)}>
        {comment.text}
      </Markdown>
    </article>
  )
}

export function MessageCard({ message }: { message: Message }) {
  const kind = messageKind(message)
  const commentId = acknowledgedCommentId(message)
  return (
    // Same anatomy as a comment; the dashed border and muted ground are what say this came
    // from the message bus rather than from the bead's own thread.
    <article className="group rounded-md border border-dashed bg-muted/20">
      <header className="flex items-center gap-2 px-3 pt-2.5">
        <ActorAvatar actor={message.created_by} className="shrink-0" />
        <span className="text-xs font-medium">
          {message.created_by ?? 'Unknown'}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {kind === 'ack' ? 'Acknowledged' : 'Message'}
        </span>
        <time
          dateTime={message.created_at}
          className="text-xs text-muted-foreground"
        >
          {relativeTime(message.created_at)}
        </time>
      </header>
      <div className={cn('px-3 pb-2.5', CARD_BODY_INSET)}>
        <Markdown className="text-[13px]">{message.description ?? ''}</Markdown>
        {commentId && (
          <a
            href={`#${commentAnchorId(commentId)}`}
            className="mt-1 inline-block text-[11px] text-sky-600 hover:underline dark:text-sky-400"
          >
            View acknowledged comment
          </a>
        )}
      </div>
    </article>
  )
}
