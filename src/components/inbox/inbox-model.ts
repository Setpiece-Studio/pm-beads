// ABOUTME: Pure inbox presentation logic — viewer-relative unread detection, the per-thread
// ABOUTME: summary the list pane renders, reply addressing, and the list sort/filter transforms.

import type { Message, MessageThread } from '@/lib/beads/types'

/** List orderings offered by the sort affordance. Threads arrive newest-first from bd. */
export const inboxSorts = ['newest', 'oldest'] as const

export type InboxSort = (typeof inboxSorts)[number]

const UNKNOWN_ADDRESS = 'unknown'

/** Compare two message addresses. bd stores sender and recipient as free text, so the
 * comparison is trimmed and case-insensitive. Absent addresses never match. */
export function sameAddress(
  a: string | undefined,
  b: string | undefined,
): boolean {
  const left = a?.trim().toLowerCase() ?? ''
  const right = b?.trim().toLowerCase() ?? ''
  return left !== '' && left === right
}

/** Up to two initials for the avatar circle: first letters of the first and last word, or
 * the first two characters of a single word. Non-letters (`agent-a`, `ben@x`) are separators. */
export function initials(name: string | undefined): string {
  const words = (name ?? '').split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '')
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

/** One-line list snippet: the first line with visible text, whitespace collapsed. */
export function bodySnippet(body: string | undefined): string {
  for (const line of (body ?? '').split('\n')) {
    const collapsed = line.replace(/\s+/g, ' ').trim()
    if (collapsed !== '') return collapsed
  }
  return ''
}

/**
 * Whether a message is unread FOR the viewer: still open AND addressed to them.
 *
 * Messages the viewer sent stay open until their recipient reads them, and messages between
 * two agents are the recipient agent's to read — neither is the viewer's unread, and neither
 * may be closed on the other party's behalf.
 */
export function isUnreadFor(message: Message, viewer: string): boolean {
  return message.status !== 'closed' && sameAddress(message.assignee, viewer)
}

/** The messages in a thread the viewer has not read. */
export function unreadMessagesFor(
  thread: MessageThread,
  viewer: string,
): Message[] {
  return thread.messages.filter((message) => isUnreadFor(message, viewer))
}

/** The party of a message that is not the viewer — who the thread reads as being with. */
function counterpart(message: Message, viewer: string): string {
  const other = sameAddress(message.created_by, viewer)
    ? message.assignee
    : message.created_by
  return other?.trim() || UNKNOWN_ADDRESS
}

function latestMessage(thread: MessageThread): Message | undefined {
  return thread.messages[thread.messages.length - 1]
}

/** What one row of the list pane shows. */
export interface ThreadSummary {
  rootId: string
  /** The root message's title — replies inherit the thread's subject. */
  subject: string
  /** The other party on the most recent message; the avatar and name in the row. */
  sender: string
  /** One-line preview of the most recent message's body. */
  snippet: string
  /** created_at of the most recent message, for the relative timestamp. */
  latestAt: string
  unreadCount: number
  messageCount: number
}

export function summarizeThread(
  thread: MessageThread,
  viewer: string,
): ThreadSummary {
  const root = thread.messages[0]
  const latest = latestMessage(thread)
  return {
    rootId: thread.rootId,
    subject: root?.title ?? '(no subject)',
    sender: latest ? counterpart(latest, viewer) : UNKNOWN_ADDRESS,
    snippet: bodySnippet(latest?.description),
    latestAt: latest?.created_at ?? '',
    unreadCount: unreadMessagesFor(thread, viewer).length,
    messageCount: thread.messages.length,
  }
}
