// ABOUTME: The inbox's one list — a row per bead, rolling that bead's messages and the activity
// ABOUTME: kinds the tab asked for into a single chronological unread signal, with a row menu.

import { AtSign, CircleHelp, MessageCircle, MessageSquare } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { ActivityItem, ActivityKind } from '@/lib/beads/inbox-activity'
import { threadIssueIds } from '@/lib/beads/messages'
import type { Issue, MessageThread } from '@/lib/beads/types'
import { beadRefTitle, relativeTime } from '@/lib/issue-meta'
import { cn } from '@/lib/utils'
import { inboxActions } from './inbox-actions'
import { bodySnippet, type InboxSort, summarizeThread } from './inbox-model'
import { InitialsAvatar } from './initials-avatar'

/** The kinds that reach Mine: everything waiting on Ben personally. */
export const PERSONAL_ACTIVITY_KINDS: readonly ActivityKind[] = [
  'ask',
  'mention',
]

/** The kinds that reach Agents: ordinary agent chatter on the viewer's beads. */
export const AGENT_ACTIVITY_KINDS: readonly ActivityKind[] = ['comment']

export interface NotificationRow {
  key: string
  /** Absent for a direct message thread with no live related bead. */
  issueId?: string
  latestAt: string
  latestType?: 'message' | 'activity'
  reasonKind?: 'message' | 'mention' | 'ask' | 'comment'
  unread: boolean
  actor: string
  title: string
  snippet: string
  threadIds: string[]
  activityIds: string[]
  representativeActivityId?: string
}

export interface NotificationRowOptions {
  /** Which activity kinds feed this row set. The two tabs are one partition of the feed:
   * Mine takes the personal kinds, Agents takes the rest. */
  kinds: readonly ActivityKind[]
  activity: readonly ActivityItem[]
  readIds: ReadonlySet<string>
  sort: InboxSort
  /** The message half of a row, which only Mine has: the Agents tab reads no messages at all,
   * so these three travel together and are absent together. */
  threads?: readonly MessageThread[]
  linkedIssues?: Readonly<Record<string, Issue>>
  viewer?: string
}

/**
 * Every bead the given activity kinds (and the given message threads) put a notification on,
 * newest first. The unread filter is deliberately NOT applied here: both panes resolve the
 * selected `?bead=` against the whole set, so a row stays open in the detail after being read
 * even when the filter has just dropped it from the list.
 */
export function notificationRows({
  kinds,
  activity,
  readIds,
  sort,
  threads = [],
  linkedIssues = {},
  // Read only while summarizing a thread, so a row set with no threads never needs one.
  viewer = '',
}: NotificationRowOptions): NotificationRow[] {
  const wanted = new Set(kinds)
  const rows = new Map<string, NotificationRow>()
  const ensure = (issueId: string, title: string) => {
    const found = rows.get(issueId)
    if (found) return found
    const row: NotificationRow = {
      key: `bead:${issueId}`,
      issueId,
      latestAt: '',
      unread: false,
      actor: '',
      title,
      snippet: '',
      threadIds: [],
      activityIds: [],
    }
    rows.set(issueId, row)
    return row
  }
  const ensureThread = (thread: MessageThread) => {
    const key = `thread:${thread.rootId}`
    const found = rows.get(key)
    if (found) return found
    const summary = summarizeThread(thread, viewer)
    const row: NotificationRow = {
      key,
      latestAt: summary.latestAt,
      latestType: 'message',
      reasonKind: 'message',
      unread: summary.unreadCount > 0,
      actor: summary.sender,
      title: summary.subject,
      snippet: summary.snippet,
      threadIds: [thread.rootId],
      activityIds: [],
    }
    rows.set(key, row)
    return row
  }
  for (const thread of threads) {
    const summary = summarizeThread(thread, viewer)
    // A stale relates-to edge must not make the message disappear. Only live beads can own a
    // bead row; a thread with no live bead remains visible as its own conversation.
    const related = threadIssueIds(thread).filter(
      (issueId) => linkedIssues[issueId] !== undefined,
    )
    if (related.length === 0) {
      ensureThread(thread)
      continue
    }
    for (const issueId of related) {
      const row = ensure(
        issueId,
        linkedIssues[issueId]?.title ?? summary.subject,
      )
      row.threadIds.push(thread.rootId)
      row.unread ||= summary.unreadCount > 0
      if (summary.latestAt >= row.latestAt)
        Object.assign(row, {
          latestAt: summary.latestAt,
          latestType: 'message',
          reasonKind: 'message',
          actor: summary.sender,
          snippet: summary.snippet,
        })
    }
  }
  for (const item of activity) {
    if (!wanted.has(item.kind)) continue
    const row = ensure(item.issueId, item.issueTitle)
    row.activityIds.push(item.id)
    row.unread ||= !readIds.has(item.id)
    if (item.createdAt >= row.latestAt)
      Object.assign(row, {
        latestAt: item.createdAt,
        latestType: 'activity',
        reasonKind: item.kind,
        actor: item.actor,
        snippet: bodySnippet(item.text),
        representativeActivityId: item.id,
      })
    else row.representativeActivityId ??= item.id
  }
  return [...rows.values()].sort((a, b) =>
    sort === 'oldest'
      ? a.latestAt.localeCompare(b.latestAt) || a.key.localeCompare(b.key)
      : b.latestAt.localeCompare(a.latestAt) || a.key.localeCompare(b.key),
  )
}

/** The list pane's rows: the unread filter, which the detail pane deliberately does not apply. */
export function visibleRows(
  rows: readonly NotificationRow[],
  unreadOnly: boolean,
): NotificationRow[] {
  return unreadOnly ? rows.filter((row) => row.unread) : [...rows]
}

/** Why the row is here, in the row's own voice. A comment is the Agents tab's only reason, and
 * saying so keeps the line reading as a sentence rather than a chip. */
function reasonLine(row: NotificationRow): string {
  switch (row.reasonKind) {
    case 'mention':
      return `${row.actor} mentioned you`
    case 'ask':
      return `${row.actor} needs your input`
    case 'comment':
      return `${row.actor} commented`
    default:
      return `${row.actor} sent you a message`
  }
}

function ReasonIcon({ kind }: { kind: NotificationRow['reasonKind'] }) {
  switch (kind) {
    case 'mention':
      return <AtSign className="size-3" />
    case 'ask':
      return <CircleHelp className="size-3" />
    case 'comment':
      return <MessageSquare className="size-3" />
    default:
      return <MessageCircle className="size-3" />
  }
}

export interface NotificationListProps {
  rows: NotificationRow[]
  /** Names the list as a landmark — the tab it belongs to. */
  label: string
  /** Shown when there are no rows; wording depends on the active filter. */
  emptyLabel: string
  selectedKey?: string
  onSelect: (row: NotificationRow) => void
  // The row menu's writes. Passed down rather than imported, because this file never imports
  // server fns — the route owns them. An absent handler drops its item from the menu.
  /** Closes every item the row aggregates, without selecting it. */
  onMarkRead?: (row: NotificationRow) => void
  /** Reopens them, without selecting it. */
  onMarkUnread?: (row: NotificationRow) => void
  /** Opens the bead's own page — selecting the row already opens it in the detail pane. */
  onOpenBead?: (row: NotificationRow) => void
}

export function NotificationList({
  rows,
  label,
  emptyLabel,
  selectedKey,
  onSelect,
  onMarkRead,
  onMarkUnread,
  onOpenBead,
}: NotificationListProps) {
  if (rows.length === 0)
    return (
      <div className="p-8 text-center text-[13px] text-muted-foreground">
        {emptyLabel}
      </div>
    )
  return (
    <ul aria-label={label} className="flex flex-col">
      {rows.map((row) => {
        // The same set the detail pane's overflow offers, so neither surface is the only way
        // to reach an action. Right-click alone would be mouse-only.
        const actions = inboxActions({
          issueId: row.issueId,
          openBead:
            row.issueId !== undefined && onOpenBead
              ? () => onOpenBead(row)
              : undefined,
          readToggle: row.unread
            ? onMarkRead && {
                label: 'Mark read',
                action: () => onMarkRead(row),
              }
            : onMarkUnread && {
                label: 'Mark unread',
                action: () => onMarkUnread(row),
              },
        })
        return (
          <li key={row.key}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  aria-current={selectedKey === row.key ? 'true' : undefined}
                  title={
                    row.issueId === undefined
                      ? `${row.title} · ${row.threadIds[0]}`
                      : beadRefTitle(row.issueId, row.title)
                  }
                  onClick={() => onSelect(row)}
                  className={cn(
                    'flex w-full gap-2.5 border-b px-3 py-2.5 text-left transition-colors',
                    // Keyboard focus has to be visible on a row you can act on: the ring is
                    // inset so it reads inside the row's own borders rather than over them.
                    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    selectedKey === row.key
                      ? 'bg-accent'
                      : 'hover:bg-accent/60',
                  )}
                >
                  <span className="relative mt-0.5 shrink-0">
                    <InitialsAvatar name={row.actor} />
                    <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground">
                      <ReasonIcon kind={row.reasonKind} />
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {reasonLine(row)}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {relativeTime(row.latestAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {row.unread && (
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full bg-sky-500"
                        />
                      )}
                      <span
                        className={cn(
                          'truncate text-[13px]',
                          row.unread
                            ? 'font-semibold text-foreground'
                            : 'text-foreground/80',
                        )}
                      >
                        {row.title}
                      </span>
                      {row.unread && <span className="sr-only">Unread</span>}
                    </span>
                    {row.snippet !== '' && (
                      <span className="truncate text-xs text-muted-foreground">
                        {row.snippet}
                      </span>
                    )}
                  </span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-44">
                {actions.map((action) => (
                  <ContextMenuItem
                    key={action.key}
                    disabled={action.disabled}
                    onSelect={action.run}
                  >
                    <action.icon />
                    {action.label}
                  </ContextMenuItem>
                ))}
              </ContextMenuContent>
            </ContextMenu>
          </li>
        )
      })}
    </ul>
  )
}
