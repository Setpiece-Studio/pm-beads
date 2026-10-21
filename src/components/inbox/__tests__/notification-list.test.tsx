// ABOUTME: Pure coverage for bead-first notification aggregation — which activity kinds feed a
// ABOUTME: row set, how messages and items collapse onto one bead, and the row's context menu.
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityItem } from '@/lib/beads/inbox-activity'
import type { Issue, Message, MessageThread } from '@/lib/beads/types'
import {
  AGENT_ACTIVITY_KINDS,
  NotificationList,
  type NotificationRow,
  notificationRows,
  PERSONAL_ACTIVITY_KINDS,
  visibleRows,
} from '../notification-list'

function message(id: string, issueId: string): Message {
  return {
    id,
    title: 'Message subject',
    description: 'Please review',
    status: 'open',
    priority: 2,
    issue_type: 'message',
    ephemeral: true,
    assignee: 'ben',
    created_by: 'agent-a',
    created_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    dependencies: [
      { issue_id: id, depends_on_id: issueId, type: 'relates-to' },
    ],
  }
}

const issue: Issue = {
  id: 'beads-1',
  title: 'The actual bead',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}
const mention: ActivityItem = {
  kind: 'mention',
  id: 'comment:c1',
  issueId: issue.id,
  issueTitle: issue.title,
  issueStatus: 'open',
  actor: 'agent-b',
  text: '@ben take a look',
  createdAt: '2026-01-03T00:00:00Z',
}

describe('notificationRows', () => {
  it('keeps an unlinked direct message as its own conversation row', () => {
    const thread: MessageThread = {
      rootId: 'msg-standalone',
      messages: [message('msg-standalone', 'missing-bead')],
    }
    thread.messages[0].dependencies = []
    const rows = notificationRows({
      kinds: PERSONAL_ACTIVITY_KINDS,
      activity: [],
      readIds: new Set(),
      sort: 'newest',
      threads: [thread],
      viewer: 'ben',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      key: 'thread:msg-standalone',
      title: 'Message subject',
      threadIds: ['msg-standalone'],
      unread: true,
    })
    expect(rows[0]).not.toHaveProperty('issueId')
  })

  it('keeps a message whose related bead is no longer available', () => {
    const thread: MessageThread = {
      rootId: 'msg-dangling',
      messages: [message('msg-dangling', 'deleted-bead')],
    }
    const rows = notificationRows({
      kinds: PERSONAL_ACTIVITY_KINDS,
      activity: [],
      readIds: new Set(),
      sort: 'newest',
      threads: [thread],
      linkedIssues: {},
      viewer: 'ben',
    })
    expect(rows[0]).toMatchObject({
      key: 'thread:msg-dangling',
      threadIds: ['msg-dangling'],
    })
    expect(rows[0]).not.toHaveProperty('issueId')
  })

  it('combines a message and mention into one row named for their bead', () => {
    const thread: MessageThread = {
      rootId: 'msg-1',
      messages: [message('msg-1', issue.id)],
    }
    const rows = notificationRows({
      kinds: PERSONAL_ACTIVITY_KINDS,
      activity: [mention],
      readIds: new Set(),
      sort: 'newest',
      threads: [thread],
      linkedIssues: { [issue.id]: issue },
      viewer: 'ben',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      issueId: issue.id,
      title: issue.title,
      unread: true,
      threadIds: ['msg-1'],
      activityIds: ['comment:c1'],
    })
  })

  it('collapses multiple personal activity items on one bead', () => {
    const ask: ActivityItem = { ...mention, kind: 'ask', id: 'ask:beads-1' }
    const rows = notificationRows({
      kinds: PERSONAL_ACTIVITY_KINDS,
      activity: [mention, ask],
      readIds: new Set(),
      sort: 'newest',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.activityIds).toEqual(['comment:c1', 'ask:beads-1'])
  })

  it('does not put ordinary agent comments in the personal row set', () => {
    expect(
      notificationRows({
        kinds: PERSONAL_ACTIVITY_KINDS,
        activity: [{ ...mention, kind: 'comment' }],
        readIds: new Set(),
        sort: 'newest',
      }),
    ).toEqual([])
  })

  it('collapses every comment on one bead into a single agent row', () => {
    const first: ActivityItem = {
      ...mention,
      kind: 'comment',
      id: 'comment:c1',
      actor: 'agent-b',
      text: 'Profiled it.',
    }
    const second: ActivityItem = {
      ...first,
      id: 'comment:c2',
      actor: 'agent-c',
      text: 'Second that.',
      createdAt: '2026-01-04T00:00:00Z',
    }
    const rows = notificationRows({
      kinds: AGENT_ACTIVITY_KINDS,
      activity: [first, second],
      readIds: new Set(['comment:c1']),
      sort: 'newest',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      issueId: issue.id,
      activityIds: ['comment:c1', 'comment:c2'],
      // The newest item names the row, and one unread item makes the row unread.
      reasonKind: 'comment',
      actor: 'agent-c',
      unread: true,
    })
  })

  it('still builds a row for a bead whose notifications are all read', () => {
    const comment: ActivityItem = { ...mention, kind: 'comment' }
    const rows = notificationRows({
      kinds: AGENT_ACTIVITY_KINDS,
      activity: [comment],
      readIds: new Set(['comment:c1']),
      sort: 'newest',
    })
    // The row exists so the detail can keep it open; only the LIST drops it under the filter.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.unread).toBe(false)
    expect(visibleRows(rows, true)).toEqual([])
    expect(visibleRows(rows, false)).toEqual(rows)
  })
})

const row: NotificationRow = {
  key: 'bead:beads-1',
  issueId: issue.id,
  latestAt: '2026-01-03T00:00:00Z',
  reasonKind: 'comment',
  unread: true,
  actor: 'agent-b',
  title: issue.title,
  snippet: 'Profiled it.',
  threadIds: [],
  activityIds: ['comment:c1'],
}

function renderList(
  patch: Partial<React.ComponentProps<typeof NotificationList>> = {},
) {
  return render(
    <NotificationList
      rows={[row]}
      label="Agents"
      emptyLabel="No activity yet"
      onSelect={() => undefined}
      {...patch}
    />,
  )
}

describe('NotificationList', () => {
  afterEach(cleanup)

  it('names the list and its empty state the way the host asked', () => {
    renderList({ rows: [], emptyLabel: 'No unread activity' })
    expect(screen.getByText('No unread activity')).toBeDefined()
    expect(screen.queryByRole('list', { name: 'Agents' })).toBeNull()
  })

  it('runs the row menu action the host wired a handler for', async () => {
    const onMarkRead = vi.fn()
    renderList({ onMarkRead })
    fireEvent.contextMenu(screen.getAllByRole('button')[0] as HTMLElement)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mark read' }))
    await waitFor(() => expect(onMarkRead).toHaveBeenCalledWith(row))
  })

  it('says a comment landed rather than a message', () => {
    renderList()
    expect(screen.getByText('agent-b commented')).toBeDefined()
  })
})
