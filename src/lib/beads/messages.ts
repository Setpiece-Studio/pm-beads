// ABOUTME: Pure message logic — the bd conventions that encode a message (type, reply edge),
// ABOUTME: inbox scope filtering against the human's address, and thread reconstruction.

import type { Message, MessageThread } from './types'

/** bd's issue type for messages. Message beads are infrastructure wisps, so plain `bd list`
 * hides them — every read needs `--include-infra --type message`. */
export const MESSAGE_ISSUE_TYPE = 'message'

/** Semantic kind stored in a message wisp's metadata. Plain conversation predates this field,
 * so an absent value remains the ordinary `message` kind. */
export const messageKinds = ['message', 'ack'] as const
export type MessageKind = (typeof messageKinds)[number]
export const MESSAGE_KIND_METADATA_KEY = 'message_kind'
export const ACK_COMMENT_METADATA_KEY = 'comment_id'

export function messageKind(message: Message): MessageKind {
  return message.metadata?.[MESSAGE_KIND_METADATA_KEY] === 'ack'
    ? 'ack'
    : 'message'
}

/** The comment acknowledged by an ack message, when the metadata is complete. */
export function acknowledgedCommentId(message: Message): string | undefined {
  if (messageKind(message) !== 'ack') return undefined
  const value = message.metadata?.[ACK_COMMENT_METADATA_KEY]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * The dependency type a reply carries back to the message it answers.
 *
 * bd 1.2.2 rejects `reply-to`; `replies-to` is the built-in it accepts, so no label fallback
 * is needed — a reply is created with `--deps 'replies-to:<parent-id>'` and the edge comes
 * back on the message's `dependencies` array as `{type: 'replies-to', depends_on_id: parent}`.
 */
export const REPLY_TO_DEPENDENCY_TYPE = 'replies-to'

/**
 * The dependency type linking a message to the issue the conversation is about.
 *
 * bd 1.2.2 accepts `relates-to` from an ephemeral message wisp to a permanent issue and
 * returns the edge on the message's `dependencies` array as
 * `{type: 'relates-to', depends_on_id: <issue-id>}`. The edge is one-directional in practice:
 * `bd show <issue>` does not list the wisp among its dependents, so the link is only ever read
 * from the message side.
 */
export const RELATES_TO_DEPENDENCY_TYPE = 'relates-to'

/** Inbox scopes: 'mine' (the human is a party), 'agents' (neither party is), 'all'. */
export const messageScopes = ['mine', 'agents', 'all'] as const

export type MessageScope = (typeof messageScopes)[number]

const DEFAULT_HUMAN_ADDRESS = 'ben'

/**
 * The human's message address(es), from PM_BEADS_USER (comma-separated), defaulting to 'ben'.
 * Aliases exist because bd stamps `created_by` from `--actor`/git user.name, so a message sent
 * outside this app can arrive as "Ben Harper" rather than "ben"; listing both keeps the Mine
 * scope honest. The FIRST entry is canonical — it is what this app sends `--actor` as.
 * Read at call time, not module load, so the env stays overridable per process/test.
 */
export function humanAddresses(): string[] {
  const configured = (process.env.PM_BEADS_USER ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  return configured.length > 0 ? configured : [DEFAULT_HUMAN_ADDRESS]
}

/** The address this app sends as (bd `--actor`), i.e. the first PM_BEADS_USER entry. */
export function humanAddress(): string {
  return humanAddresses()[0] as string
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

/** True when an assignee/created_by value is one of the human's addresses. */
export function isHumanAddress(
  value: string | undefined,
  addresses: readonly string[] = humanAddresses(),
): boolean {
  const candidate = normalize(value)
  if (candidate === '') return false
  return addresses.some((address) => normalize(address) === candidate)
}

/** The message this one replies to, or undefined for a thread root. */
export function parentMessageId(message: Message): string | undefined {
  return message.dependencies?.find(
    (dep) =>
      dep.type === REPLY_TO_DEPENDENCY_TYPE && dep.issue_id === message.id,
  )?.depends_on_id
}

/**
 * Every issue this message relates to, in the order bd returns the edges — a brief that names
 * six beads carries six `relates-to` edges, and all six belong beside the message. Duplicates
 * are collapsed; edges pointing AT the message (another bead relating to it) are not its links.
 */
export function linkedIssueIds(message: Message): string[] {
  const targets = (message.dependencies ?? [])
    .filter(
      (dep) =>
        dep.type === RELATES_TO_DEPENDENCY_TYPE && dep.issue_id === message.id,
    )
    .map((dep) => dep.depends_on_id)
  return [...new Set(targets)]
}

/** The issue this message is about, from its first `relates-to` edge, or undefined when
 * unlinked. The primary bead of a message that names several. */
export function linkedIssueId(message: Message): string | undefined {
  return linkedIssueIds(message)[0]
}

/**
 * Every issue a whole thread relates to: the union of its messages' links, ordered by first
 * appearance. Replies inherit the root's links, so the root normally supplies the whole set —
 * but a thread rooted at a reply whose parent is missing, or one linked only after the fact,
 * still contributes the beads a later message names.
 */
export function threadIssueIds(thread: MessageThread): string[] {
  const seen = new Set<string>()
  for (const message of thread.messages) {
    for (const issueId of linkedIssueIds(message)) seen.add(issueId)
  }
  return [...seen]
}

/** The issue a thread is primarily about — the first of its related beads. */
export function threadIssueId(thread: MessageThread): string | undefined {
  return threadIssueIds(thread)[0]
}

/**
 * The issues a message should carry `relates-to` edges to: the `issueIds` set plus the
 * deprecated single `issueId` alias, deduplicated, blanks dropped, in the order given.
 *
 * A reply passes the WHOLE thread's related beads rather than only its first, so a brief that
 * names six beads is still a conversation about six beads after the first answer.
 */
export function messageRelatesToIds(input: {
  issueId?: string
  issueIds?: readonly string[]
}): string[] {
  const given = [
    ...(input.issueId === undefined ? [] : [input.issueId]),
    ...(input.issueIds ?? []),
  ]
  return [...new Set(given.map((id) => id.trim()).filter((id) => id !== ''))]
}

/**
 * Split messages by inbox scope. 'mine' keeps messages where the human is either the
 * recipient (assignee) or the sender (created_by); 'agents' keeps the complement — agent
 * traffic the human can watch without being party to it.
 */
export function filterMessagesByScope(
  messages: readonly Message[],
  scope: MessageScope,
  addresses: readonly string[] = humanAddresses(),
): Message[] {
  if (scope === 'all') return [...messages]
  return messages.filter((message) => {
    const mine =
      isHumanAddress(message.assignee, addresses) ||
      isHumanAddress(message.created_by, addresses)
    return scope === 'mine' ? mine : !mine
  })
}

/** Where a message sits in its thread: which message roots it, and how many `replies-to`
 * hops below that root it is. */
interface ChainPosition {
  rootId: string
  depth: number
}

/**
 * Reconstruct reply threads from a flat message list — one bd read plus this join, the same
 * shape as buildEpicTree over the epic list. Each message walks its `replies-to` chain to a
 * root; messages sharing a root form a thread, ordered oldest first. Threads are ordered by
 * their most recent message, newest first, so the inbox reads like a conversation list.
 *
 * A reply whose parent is absent from the set (deleted, or outside the scope filter) roots
 * its own thread rather than disappearing. The walk is cycle-safe: a cycle resolves to the
 * lowest id it contains, so every member of the cycle still lands in one thread.
 *
 * Ordering within a thread breaks a created_at tie by reply depth, then id. bd's list output
 * truncates timestamps to whole seconds, so a reply sent in the same second as the message it
 * answers ties — and an id tiebreak alone would sort the reply above its parent at random.
 */
export function buildThreads(messages: readonly Message[]): MessageThread[] {
  const byId = new Map(messages.map((message) => [message.id, message]))

  const positionOf = (message: Message): ChainPosition => {
    let current = message
    let depth = 0
    const seen = new Set<string>([current.id])
    for (;;) {
      const parentId = parentMessageId(current)
      if (parentId === undefined) return { rootId: current.id, depth }
      const parent = byId.get(parentId)
      if (parent === undefined) return { rootId: current.id, depth }
      if (seen.has(parent.id))
        return { rootId: [...seen].sort()[0] as string, depth }
      seen.add(parent.id)
      current = parent
      depth++
    }
  }

  const depths = new Map<string, number>()
  const grouped = new Map<string, Message[]>()
  for (const message of messages) {
    const { rootId, depth } = positionOf(message)
    depths.set(message.id, depth)
    const bucket = grouped.get(rootId)
    if (bucket) bucket.push(message)
    else grouped.set(rootId, [message])
  }

  const chronological = (a: Message, b: Message): number =>
    a.created_at.localeCompare(b.created_at) ||
    (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0) ||
    a.id.localeCompare(b.id)

  return [...grouped.entries()]
    .map(([rootId, group]) => ({
      rootId,
      messages: [...group].sort(chronological),
    }))
    .sort(
      (a, b) =>
        latestAt(b).localeCompare(latestAt(a)) ||
        a.rootId.localeCompare(b.rootId),
    )
}

/** created_at of a thread's most recent message (its messages are already chronological). */
function latestAt(thread: MessageThread): string {
  return thread.messages[thread.messages.length - 1]?.created_at ?? ''
}
