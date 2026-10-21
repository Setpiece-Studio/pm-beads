// ABOUTME: Pure derivation of the issue activity stream — diffs consecutive bd history snapshots
// ABOUTME: into human events, and interleaves events, comments, and related messages chronologically.

import type { Comment, HistoryEntry, Issue, Message } from './types'

/** Long-text fields whose edits are reported as a single "edited <field>" event rather than
 * a before/after diff. Order fixes the event order within one multi-field commit. */
const TEXT_FIELDS = [
  'description',
  'notes',
  'design',
  'acceptance_criteria',
] as const

export type TextField = (typeof TEXT_FIELDS)[number]

/** Fields shared by every event: a stable react key, the ISO timestamp, and — when bd exposes
 * one — the human who did it. bd history records only the dolt committer, so `actor` is present
 * for the creation and for a creator self-assignment and absent everywhere else. */
interface ActivityEventBase {
  id: string
  at: string
  actor?: string
}

export type ActivityEvent =
  | (ActivityEventBase & { kind: 'created' })
  | (ActivityEventBase & { kind: 'status'; from: string; to: string })
  | (ActivityEventBase & { kind: 'closed'; reason?: string })
  | (ActivityEventBase & { kind: 'reopened'; to: string })
  | (ActivityEventBase & { kind: 'assigned'; to: string; self: boolean })
  | (ActivityEventBase & { kind: 'unassigned'; from: string })
  | (ActivityEventBase & { kind: 'priority'; from: number; to: number })
  | (ActivityEventBase & { kind: 'renamed'; from: string; to: string })
  | (ActivityEventBase & { kind: 'type'; from: string; to: string })
  | (ActivityEventBase & { kind: 'edited'; field: TextField })

export type ActivityItem =
  | { kind: 'event'; id: string; at: string; event: ActivityEvent }
  | { kind: 'comment'; id: string; at: string; comment: Comment }
  | { kind: 'message'; id: string; at: string; message: Message }

/**
 * Turn bd's newest-first history into an oldest-first event list.
 *
 * The oldest snapshot yields the `created` event (stamped with the issue's own created_at, not
 * the commit date). Every later entry is diffed against its predecessor, and one event is emitted
 * per changed field — a commit that changed nothing about the issue row yields nothing, which is
 * what label, dependency, and comment writes look like here (they commit, but bd's history
 * snapshot carries no labels/parent/dependencies).
 */
export function deriveActivityEvents(
  entries: readonly HistoryEntry[],
): ActivityEvent[] {
  if (entries.length === 0) return []
  const ordered = [...entries].reverse()
  const first = ordered[0] as HistoryEntry

  const events: ActivityEvent[] = [
    {
      kind: 'created',
      id: `${first.CommitHash}:created`,
      at: first.Issue.created_at,
      actor: first.Issue.created_by,
    },
  ]

  for (let i = 1; i < ordered.length; i++) {
    const previous = (ordered[i - 1] as HistoryEntry).Issue
    const entry = ordered[i] as HistoryEntry
    events.push(...diffSnapshots(previous, entry.Issue, entry))
  }
  return events
}

function diffSnapshots(
  before: Issue,
  after: Issue,
  entry: HistoryEntry,
): ActivityEvent[] {
  const at = entry.CommitDate
  const key = (kind: string) => `${entry.CommitHash}:${kind}`
  const events: ActivityEvent[] = []

  if (before.status !== after.status) {
    if (after.status === 'closed') {
      events.push({
        kind: 'closed',
        id: key('closed'),
        at,
        reason: after.close_reason,
      })
    } else if (before.status === 'closed') {
      events.push({
        kind: 'reopened',
        id: key('reopened'),
        at,
        to: after.status,
      })
    } else {
      events.push({
        kind: 'status',
        id: key('status'),
        at,
        from: before.status,
        to: after.status,
      })
    }
  }

  if (before.assignee !== after.assignee) {
    if (after.assignee === undefined || after.assignee === '') {
      events.push({
        kind: 'unassigned',
        id: key('unassigned'),
        at,
        from: before.assignee ?? '',
      })
    } else {
      // The creator taking the issue is the only change history can pin on a person: the
      // assignee IS the actor. Any other assignment names a target, not an author.
      const self = after.assignee === after.created_by
      events.push({
        kind: 'assigned',
        id: key('assigned'),
        at,
        to: after.assignee,
        self,
        actor: self ? after.assignee : undefined,
      })
    }
  }

  if (before.priority !== after.priority) {
    events.push({
      kind: 'priority',
      id: key('priority'),
      at,
      from: before.priority,
      to: after.priority,
    })
  }

  if (before.title !== after.title) {
    events.push({
      kind: 'renamed',
      id: key('renamed'),
      at,
      from: before.title,
      to: after.title,
    })
  }

  if (before.issue_type !== after.issue_type) {
    events.push({
      kind: 'type',
      id: key('type'),
      at,
      from: before.issue_type,
      to: after.issue_type,
    })
  }

  for (const field of TEXT_FIELDS) {
    if ((before[field] ?? '') !== (after[field] ?? '')) {
      events.push({ kind: 'edited', id: key(`edited-${field}`), at, field })
    }
  }

  return events
}

/**
 * Interleave derived events, comments, and related messages into one oldest-first stream. Sorting is stable and
 * events are concatenated first, so an event and a comment sharing a timestamp render event-first
 * (the comment is the reaction). Passing no events yields the comments-only stream used when bd
 * history is unavailable for an issue.
 */
export function mergeActivity(
  events: readonly ActivityEvent[],
  comments: readonly Comment[],
  messages: readonly Message[] = [],
): ActivityItem[] {
  const items: ActivityItem[] = [
    ...events.map(
      (event): ActivityItem => ({
        kind: 'event',
        id: event.id,
        at: event.at,
        event,
      }),
    ),
    ...comments.map(
      (comment): ActivityItem => ({
        kind: 'comment',
        id: comment.id,
        at: comment.created_at,
        comment,
      }),
    ),
    ...messages.map(
      (message): ActivityItem => ({
        kind: 'message',
        id: message.id,
        at: message.created_at,
        message,
      }),
    ),
  ]
  return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}
