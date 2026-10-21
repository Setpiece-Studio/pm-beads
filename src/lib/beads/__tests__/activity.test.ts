// ABOUTME: Unit tests for the pure activity derivation — bd history snapshot diffs into human
// ABOUTME: events, and the chronological interleave of those events with comments.

import { describe, expect, it } from 'vitest'
import {
  type ActivityEvent,
  deriveActivityEvents,
  mergeActivity,
} from '../activity'
import type { Comment, HistoryEntry, Issue, Message } from '../types'

const CREATED_AT = '2026-06-01T10:00:00Z'

function snapshot(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'pm-1',
    title: 'Fix the flux capacitor',
    description: 'initial desc',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: CREATED_AT,
    created_by: 'Doc Brown',
    updated_at: CREATED_AT,
    ...overrides,
  }
}

/** bd emits history newest-first; the helper takes snapshots oldest-first and reverses,
 * so each case reads in the order the changes actually happened. */
function history(...snapshots: Issue[]): HistoryEntry[] {
  return snapshots
    .map((issue, index) => ({
      CommitHash: `hash${index}`,
      Committer: 'root',
      CommitDate: new Date(
        Date.parse(CREATED_AT) + index * 60_000,
      ).toISOString(),
      Issue: issue,
    }))
    .reverse()
}

function kinds(events: ActivityEvent[]): string[] {
  return events.map((event) => event.kind)
}

describe('deriveActivityEvents', () => {
  it('returns nothing for an empty history', () => {
    expect(deriveActivityEvents([])).toEqual([])
  })

  it('derives a created event from the oldest snapshot, stamped with created_at', () => {
    const events = deriveActivityEvents(history(snapshot()))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      kind: 'created',
      actor: 'Doc Brown',
      at: CREATED_AT,
    })
  })

  it('derives a status change from consecutive snapshots', () => {
    const events = deriveActivityEvents(
      history(snapshot(), snapshot({ status: 'in_progress' })),
    )
    expect(kinds(events)).toEqual(['created', 'status'])
    expect(events[1]).toMatchObject({
      kind: 'status',
      from: 'open',
      to: 'in_progress',
    })
  })

  it('derives close and reopen rather than a bare status change', () => {
    const events = deriveActivityEvents(
      history(
        snapshot(),
        snapshot({ status: 'closed', close_reason: 'shipped it' }),
        snapshot({ status: 'open' }),
      ),
    )
    expect(kinds(events)).toEqual(['created', 'closed', 'reopened'])
    expect(events[1]).toMatchObject({ kind: 'closed', reason: 'shipped it' })
    expect(events[2]).toMatchObject({ kind: 'reopened', to: 'open' })
  })

  it('derives assignment, self-assignment, and unassignment', () => {
    const events = deriveActivityEvents(
      history(
        snapshot(),
        snapshot({ assignee: 'Marty' }),
        snapshot({ assignee: 'Doc Brown' }),
        snapshot({}),
      ),
    )
    expect(kinds(events)).toEqual([
      'created',
      'assigned',
      'assigned',
      'unassigned',
    ])
    expect(events[1]).toMatchObject({
      kind: 'assigned',
      to: 'Marty',
      self: false,
    })
    // The creator assigning themselves is the one change bd's history can attribute to a
    // human, so it renders as a self-assignment.
    expect(events[2]).toMatchObject({
      kind: 'assigned',
      to: 'Doc Brown',
      self: true,
      actor: 'Doc Brown',
    })
    expect(events[3]).toMatchObject({ kind: 'unassigned', from: 'Doc Brown' })
  })

  it('derives priority, title, and type changes', () => {
    const events = deriveActivityEvents(
      history(
        snapshot(),
        snapshot({ priority: 0 }),
        snapshot({ priority: 0, title: 'Renamed' }),
        snapshot({ priority: 0, title: 'Renamed', issue_type: 'bug' }),
      ),
    )
    expect(kinds(events)).toEqual(['created', 'priority', 'renamed', 'type'])
    expect(events[1]).toMatchObject({ kind: 'priority', from: 2, to: 0 })
    expect(events[2]).toMatchObject({
      kind: 'renamed',
      from: 'Fix the flux capacitor',
      to: 'Renamed',
    })
    expect(events[3]).toMatchObject({ kind: 'type', from: 'task', to: 'bug' })
  })

  it('derives one edited event per long-text field that changed', () => {
    const events = deriveActivityEvents(
      history(
        snapshot(),
        snapshot({ description: 'rewritten', notes: 'a note' }),
      ),
    )
    expect(kinds(events)).toEqual(['created', 'edited', 'edited'])
    expect(
      events.map((event) => ('field' in event ? event.field : null)),
    ).toEqual([null, 'description', 'notes'])
  })

  it('emits every change in a multi-field commit, keyed uniquely per kind', () => {
    const events = deriveActivityEvents(
      history(snapshot(), snapshot({ status: 'in_progress', priority: 1 })),
    )
    expect(kinds(events)).toEqual(['created', 'status', 'priority'])
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length)
  })

  it('skips commits that left the issue row untouched', () => {
    // Label, dependency, and comment writes each produce a dolt commit whose issue snapshot
    // is byte-identical — bd history's Issue payload carries no labels/parent/dependencies.
    const events = deriveActivityEvents(
      history(snapshot(), snapshot(), snapshot(), snapshot({ priority: 1 })),
    )
    expect(kinds(events)).toEqual(['created', 'priority'])
  })

  it('returns events oldest-first with the commit date as the timestamp', () => {
    const events = deriveActivityEvents(
      history(snapshot(), snapshot({ status: 'in_progress' })),
    )
    const times = events.map((event) => Date.parse(event.at))
    expect(times[0]).toBeLessThan(times[1] as number)
  })
})

describe('mergeActivity', () => {
  function comment(id: string, created_at: string): Comment {
    return {
      id,
      issue_id: 'pm-1',
      author: 'Marty',
      text: `body ${id}`,
      created_at,
    }
  }

  function message(id: string, created_at: string): Message {
    return {
      id,
      title: 'Acknowledged response',
      description: 'Acknowledged',
      status: 'open',
      priority: 2,
      issue_type: 'message',
      ephemeral: true,
      created_at,
      updated_at: created_at,
    }
  }

  it('interleaves events and comments chronologically, oldest first', () => {
    const events = deriveActivityEvents(
      history(snapshot(), snapshot({ status: 'in_progress' })),
    )
    const items = mergeActivity(events, [
      comment('c2', '2026-06-01T10:02:00Z'),
      comment('c1', '2026-06-01T10:00:30Z'),
    ])
    expect(items.map((item) => item.kind)).toEqual([
      'event',
      'comment',
      'event',
      'comment',
    ])
    expect(items.map((item) => item.id)).toEqual([
      'hash0:created',
      'c1',
      'hash1:status',
      'c2',
    ])
  })

  it('orders an event ahead of a comment sharing its timestamp', () => {
    const events = deriveActivityEvents(history(snapshot()))
    const items = mergeActivity(events, [comment('c1', CREATED_AT)])
    expect(items.map((item) => item.kind)).toEqual(['event', 'comment'])
  })

  it('interleaves related messages with durable comments and history', () => {
    const events = deriveActivityEvents(history(snapshot()))
    const items = mergeActivity(
      events,
      [comment('c1', '2026-06-01T10:01:00Z')],
      [message('w1', '2026-06-01T10:02:00Z')],
    )
    expect(items.map((item) => item.kind)).toEqual([
      'event',
      'comment',
      'message',
    ])
  })

  it('returns comments alone when history was unavailable', () => {
    const items = mergeActivity([], [comment('c1', CREATED_AT)])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'comment', id: 'c1' })
  })

  it('returns an empty stream for an issue with neither events nor comments', () => {
    expect(mergeActivity([], [])).toEqual([])
  })
})
