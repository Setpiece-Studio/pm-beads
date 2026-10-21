// ABOUTME: Typed read queries over the bd CLI: issues, epics, comments, messages, per-issue
// ABOUTME: history (the activity stream), and persistent memories.

import { z } from 'zod'
import { type ActivityEvent, deriveActivityEvents } from './activity'
import {
  getCachedActivitySnapshot,
  getCachedAllIssues,
  getCachedAllMessages,
  getCachedEpicStatuses,
  getCachedMemories,
} from './cache'
import { type BdOptions, runBd, runBdJson } from './cli'
import {
  type ActivityItem,
  type ActivitySnapshot,
  activityWindowStart,
  selectActivityItems,
} from './inbox-activity'
import { readInboxConfig } from './inbox-store'
import {
  buildThreads,
  filterMessagesByScope,
  humanAddress,
  humanAddresses,
  isHumanAddress,
  linkedIssueIds,
  type MessageScope,
  threadIssueIds,
} from './messages'
import {
  type Comment,
  commentSchema,
  type EpicStatus,
  type HistoryEntry,
  historyEntrySchema,
  type Inbox,
  type Issue,
  type Memory,
  type Message,
  type MessageThread,
  memorySchema,
  recallMemorySchema,
  type ShowIssue,
  showIssueSchema,
} from './types'

export interface ListIssuesFilters {
  /** Filter by statuses (comma-joined into bd --status). */
  statuses?: string[]
  /** Filter by issue types (comma-joined into bd --type). */
  types?: string[]
  /** Only issues under this epic (bd --parent, recursive). */
  parent?: string
  /** Only immediate children of this issue; unlike `parent`, excludes descendants. */
  directParent?: string
  /** Include closed issues (bd excludes them by default). */
  all?: boolean
}

export async function listIssues(
  filters: ListIssuesFilters = {},
  opts: BdOptions = {},
): Promise<Issue[]> {
  const allIssues = await getCachedAllIssues(opts)
  let issues = allIssues
  if (!filters.all) issues = issues.filter((issue) => issue.status !== 'closed')
  if (filters.statuses?.length) {
    const statuses = new Set(filters.statuses)
    issues = issues.filter((issue) => statuses.has(issue.status))
  }
  if (filters.types?.length) {
    const types = new Set(filters.types)
    issues = issues.filter((issue) => types.has(issue.issue_type))
  }
  if (filters.parent) {
    const parent = filters.parent
    issues = issues.filter((issue) => hasAncestor(issue, parent, allIssues))
  }
  if (filters.directParent) {
    issues = issues.filter((issue) => issue.parent === filters.directParent)
  }
  return issues
}

function hasAncestor(
  issue: Issue,
  ancestorId: string,
  issues: readonly Issue[],
): boolean {
  const byId = new Map(issues.map((item) => [item.id, item]))
  const seen = new Set<string>()
  let parent = issue.parent
  while (parent !== undefined && !seen.has(parent)) {
    if (parent === ancestorId) return true
    seen.add(parent)
    parent = byId.get(parent)?.parent
  }
  return false
}

/** bd show returns a single-element array; this unwraps it. Rejects if the issue is missing. */
export async function getIssue(
  id: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  const raw = await runBdJson(['show', id, '--json'], opts)
  const parsed = z.array(showIssueSchema).parse(raw ?? [])
  const issue = parsed[0]
  if (!issue) throw new Error(`Issue not found: ${id}`)
  return issue
}

/** Epics with computed progress — the source for the projects view. */
export async function listEpics(opts: BdOptions = {}): Promise<EpicStatus[]> {
  return getCachedEpicStatuses(opts)
}

export async function listIssueComments(
  id: string,
  opts: BdOptions = {},
): Promise<Comment[]> {
  const raw = await runBdJson(['comments', id, '--json'], opts)
  return z.array(commentSchema).parse(raw ?? [])
}

/** Per-issue dolt commit history, newest first. Raw — see deriveActivityEvents for the diff. */
export async function listIssueHistory(
  id: string,
  opts: BdOptions = {},
): Promise<HistoryEntry[]> {
  const raw = await runBdJson(['history', id, '--json'], opts)
  return z.array(historyEntrySchema).parse(raw ?? [])
}

/** Comments, related messages, and history-derived events for one issue. */
export interface IssueActivity {
  events: ActivityEvent[]
  comments: Comment[]
  /** Ephemeral conversation attached to this durable bead, including read/closed messages. */
  messages: Message[]
  /** True when bd history could not be read and the stream has comments/messages only. */
  historyUnavailable: boolean
}

/**
 * Read one issue's activity. Comments are load-bearing and propagate their failures; history is
 * advisory, so ANY failure reading or parsing it degrades to a comments-only stream instead of
 * breaking the page. bd 1.2.2 still crashes with "converting NULL to string is unsupported" on
 * legacy issues whose description is SQL NULL (pm-beads-574), and there is no CLI backfill for
 * them — embedded mode rejects `bd sql` — so this degradation is permanent for those rows.
 */
export async function getIssueActivity(
  id: string,
  opts: BdOptions = {},
): Promise<IssueActivity> {
  const comments = await listIssueComments(id, opts)
  let messages: Message[] = []
  try {
    messages = (await getCachedAllMessages(opts)).filter((message) =>
      linkedIssueIds(message).includes(id),
    )
  } catch {
    // Related wisps are advisory. A message-list failure must not hide durable comments.
  }
  try {
    const entries = await listIssueHistory(id, opts)
    return {
      events: deriveActivityEvents(entries),
      comments,
      messages,
      historyUnavailable: false,
    }
  } catch {
    return { events: [], comments, messages, historyUnavailable: true }
  }
}

export interface ListMessagesFilters {
  /** Inbox scope — 'mine' (the human is a party), 'agents', or 'all'. Defaults to 'all'. */
  scope?: MessageScope
  /** Include read (closed) messages. Unread only by default. */
  includeClosed?: boolean
}

export async function listMessages(
  filters: ListMessagesFilters = {},
  opts: BdOptions = {},
): Promise<Message[]> {
  const allMessages = await getCachedAllMessages(opts)
  const visible = filters.includeClosed
    ? allMessages
    : allMessages.filter((message) => message.status !== 'closed')
  return filterMessagesByScope(visible, filters.scope ?? 'all')
}

/** A single message by id, read or unread. Rejects if it is missing. */
export async function getMessage(
  id: string,
  opts: BdOptions = {},
): Promise<Message> {
  const message = (await getCachedAllMessages(opts)).find(
    (candidate) => candidate.id === id,
  )
  if (!message) throw new Error(`Message not found: ${id}`)
  return message
}

/** The reply thread containing `id`, oldest first. Read messages are included — a message
 * stays part of its thread after it is read — and the thread is rebuilt from the one cached
 * message list rather than walking bd edge by edge. */
export async function getThread(
  id: string,
  opts: BdOptions = {},
): Promise<MessageThread> {
  const threads = buildThreads(await getCachedAllMessages(opts))
  const thread = threads.find((candidate) =>
    candidate.messages.some((message) => message.id === id),
  )
  if (!thread) throw new Error(`Message not found: ${id}`)
  return thread
}

/** The inbox for a scope: the viewer's address plus the reply threads in that scope, newest
 * thread first. Read messages are always included — a thread keeps its history after it is
 * read — so the list pane can render whole conversations, not just the unread tail.
 *
 * Each thread's linked issue (its `relates-to` target) is resolved here too, out of the cached
 * issue list — one read for the whole inbox instead of a bd show per selected thread. A link
 * whose target no longer exists is simply absent from the map. */
export async function readInbox(
  filters: ListMessagesFilters = {},
  opts: BdOptions = {},
): Promise<Inbox> {
  const messages = await listMessages(
    { scope: filters.scope, includeClosed: true },
    opts,
  )
  const threads = buildThreads(messages)
  return {
    viewer: humanAddress(),
    threads,
    linkedIssues: await resolveLinkedIssues(threads, opts),
  }
}

/** The issues the threads link to, keyed by id — EVERY `relates-to` target, not just each
 * thread's primary, so the thread pane's related-beads rail can render the whole set. Reads
 * nothing when no thread is linked. */
async function resolveLinkedIssues(
  threads: readonly MessageThread[],
  opts: BdOptions,
): Promise<Record<string, Issue>> {
  const wanted = new Set(threads.flatMap((thread) => threadIssueIds(thread)))
  if (wanted.size === 0) return {}
  const linked: Record<string, Issue> = {}
  // --all, so a thread about a closed issue still shows its card.
  for (const issue of await getCachedAllIssues(opts)) {
    if (wanted.has(issue.id)) linked[issue.id] = issue
  }
  return linked
}

/** Unread messages addressed to the viewer, across every scope — the sidebar badge count.
 * Messages the viewer SENT are open until the recipient reads them, so they are excluded:
 * an unread count means "waiting on you". */
export async function countUnreadMessages(
  opts: BdOptions = {},
): Promise<number> {
  const messages = await getCachedAllMessages(opts)
  return messages.filter(
    (message) =>
      message.status !== 'closed' && isHumanAddress(message.assignee),
  ).length
}

/** What the inbox's Activity tab loads for one project. */
export interface ActivityInbox {
  /** The viewer's canonical address, for the reply composer's byline. */
  viewer: string
  items: ActivityItem[]
  /** Item ids already read, from the project's sidecar. */
  readIds: string[]
  /** Which fetch path answered — 'cli' means the embedded fallback and its mention gap. */
  source: ActivitySnapshot['source']
  /** True when the embedded fallback stopped short of reading every candidate bead. */
  truncated: boolean
}

/** The activity feed plus its read state, for one project. The window floor comes from the
 * sidecar's `inbox.activitySince` when set, and the default 30-day window otherwise. */
export async function readActivityInbox(
  projectDir: string,
): Promise<ActivityInbox> {
  const viewer = humanAddresses()
  const config = readInboxConfig(projectDir)
  const since = config.activitySince ?? activityWindowStart()
  const snapshot = await getCachedActivitySnapshot(projectDir, viewer, since)
  return {
    viewer: humanAddress(),
    items: selectActivityItems(snapshot, { viewer, since }),
    readIds: config.readActivityIds,
    source: snapshot.source,
    truncated: snapshot.truncated,
  }
}

/** Unread activity items for the sidebar badge — the feed minus what the sidecar records as
 * read. Counted beside the unread message count, so the badge means "waiting on you" whichever
 * shape the ask arrived in. */
export async function countUnreadActivity(projectDir: string): Promise<number> {
  const { items, readIds } = await readActivityInbox(projectDir)
  const read = new Set(readIds)
  return items.filter((item) => !read.has(item.id)).length
}

export async function listMemories(opts: BdOptions = {}): Promise<Memory[]> {
  return getCachedMemories(opts)
}

export async function getMemory(
  key: string,
  opts: BdOptions = {},
): Promise<Memory> {
  let stdout: string
  try {
    stdout = await runBd(['recall', key, '--json'], opts)
  } catch (error) {
    const maybeStdout =
      error !== null &&
      typeof error === 'object' &&
      'stdout' in error &&
      typeof (error as { stdout?: unknown }).stdout === 'string'
        ? (error as { stdout: string }).stdout
        : undefined
    if (maybeStdout === undefined || maybeStdout.trim() === '') throw error
    stdout = maybeStdout
  }
  const raw = JSON.parse(stdout)
  const parsed = recallMemorySchema.parse(raw)
  if (!parsed.found) throw new Error(`Memory not found: ${key}`)
  return memorySchema.parse(parsed)
}
