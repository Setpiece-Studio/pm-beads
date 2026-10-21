// ABOUTME: Unit coverage for the pure message logic — reply-to edge reading, linked-issue edge
// ABOUTME: reading, inbox scope filtering against the human address, and thread reconstruction.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acknowledgedCommentId,
  buildThreads,
  filterMessagesByScope,
  humanAddress,
  humanAddresses,
  linkedIssueId,
  linkedIssueIds,
  messageKind,
  messageRelatesToIds,
  parentMessageId,
  threadIssueId,
  threadIssueIds,
} from '../messages'
import type { Message } from '../types'

interface MessagePatch {
  id: string
  title?: string
  assignee?: string
  created_by?: string
  created_at?: string
  status?: string
  replyTo?: string
  /** A non-reply edge, to prove the reply walk ignores other dependency types. */
  relatedTo?: string
  /** The issue this message is about — a `relates-to` edge. */
  issueId?: string
  /** Several `relates-to` edges, in the order bd returns them. */
  issueIds?: string[]
  metadata?: Message['metadata']
}

function message(patch: MessagePatch): Message {
  const {
    id,
    replyTo,
    relatedTo,
    issueId,
    issueIds,
    created_at = '2026-01-01T00:00:00Z',
    ...rest
  } = patch
  const dependencies = [
    ...(replyTo === undefined
      ? []
      : [{ issue_id: id, depends_on_id: replyTo, type: 'replies-to' }]),
    ...(relatedTo === undefined
      ? []
      : [{ issue_id: id, depends_on_id: relatedTo, type: 'related' }]),
    ...[...(issueId === undefined ? [] : [issueId]), ...(issueIds ?? [])].map(
      (target) => ({ issue_id: id, depends_on_id: target, type: 'relates-to' }),
    ),
  ]
  return {
    id,
    title: 'Subject',
    status: 'open',
    priority: 2,
    issue_type: 'message',
    ephemeral: true,
    created_at,
    updated_at: created_at,
    ...(dependencies.length > 0 ? { dependencies } : {}),
    ...rest,
  }
}

function threadIds(messages: Message[]): string[][] {
  return buildThreads(messages).map((thread) =>
    thread.messages.map((item) => item.id),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parentMessageId', () => {
  it('reads the replies-to edge a reply carries', () => {
    expect(parentMessageId(message({ id: 'w-2', replyTo: 'w-1' }))).toBe('w-1')
  })

  it('ignores dependency types other than replies-to', () => {
    expect(parentMessageId(message({ id: 'w-2', relatedTo: 'w-1' }))).toBe(
      undefined,
    )
  })
})

describe('messageKind', () => {
  it('defaults old messages and reads typed acknowledgment metadata', () => {
    expect(messageKind(message({ id: 'plain' }))).toBe('message')
    const ack = message({
      id: 'ack',
      metadata: { message_kind: 'ack', comment_id: 'comment-123' },
    })
    expect(messageKind(ack)).toBe('ack')
    expect(acknowledgedCommentId(ack)).toBe('comment-123')
  })
})

describe('buildThreads', () => {
  it('groups a root and its replies into one chronological thread', () => {
    const messages = [
      message({
        id: 'w-3',
        replyTo: 'w-2',
        created_at: '2026-01-01T02:00:00Z',
      }),
      message({ id: 'w-1', created_at: '2026-01-01T00:00:00Z' }),
      message({
        id: 'w-2',
        replyTo: 'w-1',
        created_at: '2026-01-01T01:00:00Z',
      }),
    ]

    expect(threadIds(messages)).toEqual([['w-1', 'w-2', 'w-3']])
  })

  it('keeps a reply below its parent when their timestamps tie', () => {
    // bd truncates created_at to whole seconds, so a fast reply shares its parent's
    // timestamp; the id tiebreak alone would put 'a-reply' above 'b-root'.
    const sameSecond = '2026-01-01T00:00:00Z'
    const messages = [
      message({ id: 'a-reply', replyTo: 'b-root', created_at: sameSecond }),
      message({ id: 'b-root', created_at: sameSecond }),
    ]

    expect(threadIds(messages)).toEqual([['b-root', 'a-reply']])
  })

  it('roots every reply at the head of its chain, however deep', () => {
    const messages = [
      message({ id: 'w-1', created_at: '2026-01-01T00:00:00Z' }),
      message({
        id: 'w-2',
        replyTo: 'w-1',
        created_at: '2026-01-01T01:00:00Z',
      }),
      message({
        id: 'w-3',
        replyTo: 'w-2',
        created_at: '2026-01-01T02:00:00Z',
      }),
      message({
        id: 'w-4',
        replyTo: 'w-3',
        created_at: '2026-01-01T03:00:00Z',
      }),
    ]

    expect(buildThreads(messages).map((thread) => thread.rootId)).toEqual([
      'w-1',
    ])
  })

  it('orders threads by their most recent message, newest first', () => {
    const messages = [
      message({ id: 'w-1', created_at: '2026-01-01T00:00:00Z' }),
      message({
        id: 'w-2',
        replyTo: 'w-1',
        created_at: '2026-01-03T00:00:00Z',
      }),
      message({ id: 'w-9', created_at: '2026-01-02T00:00:00Z' }),
    ]

    expect(threadIds(messages)).toEqual([['w-1', 'w-2'], ['w-9']])
  })

  it('starts a new thread for a reply whose parent is not in the set', () => {
    const messages = [
      message({
        id: 'w-5',
        replyTo: 'w-gone',
        created_at: '2026-01-01T00:00:00Z',
      }),
    ]

    expect(buildThreads(messages)).toEqual([
      { rootId: 'w-5', messages: [messages[0]] },
    ])
  })

  it('keeps an orphaned reply and its own replies together', () => {
    const messages = [
      message({
        id: 'w-5',
        replyTo: 'w-gone',
        created_at: '2026-01-01T00:00:00Z',
      }),
      message({
        id: 'w-6',
        replyTo: 'w-5',
        created_at: '2026-01-01T01:00:00Z',
      }),
    ]

    expect(threadIds(messages)).toEqual([['w-5', 'w-6']])
  })

  it('terminates on a reply cycle and puts its members in one thread', () => {
    const messages = [
      message({
        id: 'w-a',
        replyTo: 'w-b',
        created_at: '2026-01-01T00:00:00Z',
      }),
      message({
        id: 'w-b',
        replyTo: 'w-a',
        created_at: '2026-01-01T01:00:00Z',
      }),
    ]

    expect(threadIds(messages)).toEqual([['w-a', 'w-b']])
  })

  it('breaks created_at ties by id so the order is total', () => {
    const messages = [
      message({ id: 'w-b', replyTo: 'w-a' }),
      message({ id: 'w-a' }),
    ]

    expect(threadIds(messages)).toEqual([['w-a', 'w-b']])
  })

  it('returns no threads for an empty message list', () => {
    expect(buildThreads([])).toEqual([])
  })
})

describe('human address configuration', () => {
  it('defaults to ben', () => {
    vi.stubEnv('PM_BEADS_USER', undefined)
    expect(humanAddresses()).toEqual(['ben'])
    expect(humanAddress()).toBe('ben')
  })

  it('reads PM_BEADS_USER as a comma-separated alias list, first is canonical', () => {
    vi.stubEnv('PM_BEADS_USER', 'ben, Ben Harper')
    expect(humanAddresses()).toEqual(['ben', 'Ben Harper'])
    expect(humanAddress()).toBe('ben')
  })
})

describe('filterMessagesByScope', () => {
  const toBen = message({ id: 'w-1', assignee: 'ben', created_by: 'agent-a' })
  const fromBen = message({ id: 'w-2', assignee: 'agent-a', created_by: 'ben' })
  const agentToAgent = message({
    id: 'w-3',
    assignee: 'agent-b',
    created_by: 'agent-a',
  })
  const all = [toBen, fromBen, agentToAgent]

  it('keeps messages where the human is either party for scope mine', () => {
    expect(filterMessagesByScope(all, 'mine')).toEqual([toBen, fromBen])
  })

  it('keeps messages where the human is neither party for scope agents', () => {
    expect(filterMessagesByScope(all, 'agents')).toEqual([agentToAgent])
  })

  it('keeps everything for scope all', () => {
    expect(filterMessagesByScope(all, 'all')).toEqual(all)
  })

  it('matches the human address case-insensitively', () => {
    const shouty = message({
      id: 'w-4',
      assignee: 'BEN',
      created_by: 'agent-a',
    })
    expect(filterMessagesByScope([shouty], 'mine')).toEqual([shouty])
  })

  it('honours a PM_BEADS_USER override', () => {
    vi.stubEnv('PM_BEADS_USER', 'agent-b')
    expect(filterMessagesByScope(all, 'mine')).toEqual([agentToAgent])
    expect(filterMessagesByScope(all, 'agents')).toEqual([toBen, fromBen])
  })

  it('treats a message with no assignee or sender as not the human’s', () => {
    const anonymous = message({ id: 'w-5' })
    expect(filterMessagesByScope([anonymous], 'mine')).toEqual([])
    expect(filterMessagesByScope([anonymous], 'agents')).toEqual([anonymous])
  })
})

describe('linkedIssueId', () => {
  it('reads the relates-to target off a message', () => {
    expect(linkedIssueId(message({ id: 'w-1', issueId: 'pm-42' }))).toBe(
      'pm-42',
    )
  })

  it('is undefined for a message with no dependencies at all', () => {
    expect(linkedIssueId(message({ id: 'w-1' }))).toBeUndefined()
  })

  it('ignores reply and other edge types', () => {
    const linked = message({ id: 'w-2', replyTo: 'w-1', relatedTo: 'pm-9' })
    expect(linkedIssueId(linked)).toBeUndefined()
  })

  it('ignores an edge that points AT this message rather than out of it', () => {
    const inbound: Message = {
      ...message({ id: 'w-1' }),
      dependencies: [
        { issue_id: 'w-other', depends_on_id: 'w-1', type: 'relates-to' },
      ],
    }
    expect(linkedIssueId(inbound)).toBeUndefined()
  })
})

describe('threadIssueId', () => {
  it('takes the root message’s linked issue', () => {
    const root = message({ id: 'w-1', issueId: 'pm-42' })
    const reply = message({
      id: 'w-2',
      replyTo: 'w-1',
      issueId: 'pm-42',
      created_at: '2026-01-02T00:00:00Z',
    })
    expect(threadIssueId(buildThreads([root, reply])[0])).toBe('pm-42')
  })

  it('falls back to the first later message carrying a link', () => {
    const root = message({ id: 'w-1' })
    const reply = message({
      id: 'w-2',
      replyTo: 'w-1',
      issueId: 'pm-7',
      created_at: '2026-01-02T00:00:00Z',
    })
    expect(threadIssueId(buildThreads([root, reply])[0])).toBe('pm-7')
  })

  it('is undefined when no message in the thread is linked', () => {
    const root = message({ id: 'w-1' })
    expect(threadIssueId(buildThreads([root])[0])).toBeUndefined()
  })
})

describe('linkedIssueIds', () => {
  it('reads every relates-to target in edge order', () => {
    const brief = message({ id: 'w-1', issueIds: ['pm-9', 'pm-2', 'pm-42'] })
    expect(linkedIssueIds(brief)).toEqual(['pm-9', 'pm-2', 'pm-42'])
  })

  it('is empty for an unlinked message', () => {
    expect(linkedIssueIds(message({ id: 'w-1', replyTo: 'w-0' }))).toEqual([])
  })

  it('drops a duplicate edge to the same issue', () => {
    const twice = message({ id: 'w-1', issueIds: ['pm-9', 'pm-9'] })
    expect(linkedIssueIds(twice)).toEqual(['pm-9'])
  })

  it('ignores edges pointing AT this message rather than out of it', () => {
    const inbound: Message = {
      ...message({ id: 'w-1' }),
      dependencies: [
        { issue_id: 'w-other', depends_on_id: 'w-1', type: 'relates-to' },
      ],
    }
    expect(linkedIssueIds(inbound)).toEqual([])
  })
})

describe('threadIssueIds', () => {
  it('unions every message’s links, ordered by first appearance', () => {
    const root = message({ id: 'w-1', issueIds: ['pm-9', 'pm-2'] })
    const reply = message({
      id: 'w-2',
      replyTo: 'w-1',
      issueIds: ['pm-2', 'pm-42'],
      created_at: '2026-01-02T00:00:00Z',
    })
    expect(threadIssueIds(buildThreads([root, reply])[0])).toEqual([
      'pm-9',
      'pm-2',
      'pm-42',
    ])
  })

  it('is empty when no message in the thread is linked', () => {
    expect(threadIssueIds(buildThreads([message({ id: 'w-1' })])[0])).toEqual(
      [],
    )
  })

  it('agrees with threadIssueId on the primary bead', () => {
    const root = message({ id: 'w-1', issueIds: ['pm-9', 'pm-2'] })
    const thread = buildThreads([root])[0]
    expect(threadIssueIds(thread)[0]).toBe(threadIssueId(thread))
  })
})

describe('messageRelatesToIds', () => {
  it('keeps every id a reply was given, in order', () => {
    expect(
      messageRelatesToIds({ issueIds: ['pm-9', 'pm-2', 'pm-42'] }),
    ).toEqual(['pm-9', 'pm-2', 'pm-42'])
  })

  it('merges the deprecated single alias ahead of the set', () => {
    expect(
      messageRelatesToIds({ issueId: 'pm-1', issueIds: ['pm-9'] }),
    ).toEqual(['pm-1', 'pm-9'])
  })

  it('wires one edge per bead when the alias repeats a member of the set', () => {
    expect(
      messageRelatesToIds({ issueId: 'pm-9', issueIds: ['pm-9', 'pm-2'] }),
    ).toEqual(['pm-9', 'pm-2'])
  })

  it('collapses duplicates inside the set itself', () => {
    expect(messageRelatesToIds({ issueIds: ['pm-9', 'pm-9'] })).toEqual([
      'pm-9',
    ])
  })

  it('trims and drops blanks rather than asking bd to wire an empty edge', () => {
    expect(messageRelatesToIds({ issueIds: [' pm-9 ', '', '   '] })).toEqual([
      'pm-9',
    ])
  })

  it('is empty for a message about nothing', () => {
    expect(messageRelatesToIds({})).toEqual([])
    expect(messageRelatesToIds({ issueIds: [] })).toEqual([])
  })
})
