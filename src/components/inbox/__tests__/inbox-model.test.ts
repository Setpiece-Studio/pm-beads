// ABOUTME: Unit coverage for the pure inbox presentation logic — initials, snippets,
// ABOUTME: viewer-relative unread, thread summaries, reply addressing, and sort/filter.

import { describe, expect, it } from 'vitest'
import type { Message, MessageThread } from '@/lib/beads/types'
import {
  bodySnippet,
  initials,
  isUnreadFor,
  sameAddress,
  summarizeThread,
  unreadMessagesFor,
} from '../inbox-model'

interface MessagePatch {
  id: string
  title?: string
  description?: string
  assignee?: string
  created_by?: string
  created_at?: string
  status?: string
}

function message(patch: MessagePatch): Message {
  const { id, created_at = '2026-01-01T00:00:00Z', ...rest } = patch
  return {
    id,
    title: 'Subject',
    status: 'open',
    priority: 2,
    issue_type: 'message',
    ephemeral: true,
    created_at,
    updated_at: created_at,
    ...rest,
  }
}

function thread(rootId: string, messages: Message[]): MessageThread {
  return { rootId, messages }
}

describe('sameAddress', () => {
  it('compares case- and whitespace-insensitively', () => {
    expect(sameAddress('Ben', ' ben ')).toBe(true)
    expect(sameAddress('ben', 'agent-a')).toBe(false)
  })

  it('never matches an absent or empty address', () => {
    expect(sameAddress(undefined, undefined)).toBe(false)
    expect(sameAddress('', '')).toBe(false)
  })
})

describe('initials', () => {
  it('takes the first and last word of a multi-word name', () => {
    expect(initials('Ben Harper')).toBe('BH')
  })

  it('treats punctuation in agent handles as a word break', () => {
    expect(initials('agent-a')).toBe('AA')
    expect(initials('ben@example.co')).toBe('BC')
  })

  it('falls back to the first two characters of a single word', () => {
    expect(initials('ben')).toBe('BE')
  })

  it('renders a placeholder for a missing name', () => {
    expect(initials(undefined)).toBe('?')
    expect(initials('   ')).toBe('?')
  })
})

describe('bodySnippet', () => {
  it('collapses the first non-empty line', () => {
    expect(bodySnippet('\n\n  hello   there \nsecond line')).toBe('hello there')
  })

  it('returns empty for a missing or blank body', () => {
    expect(bodySnippet(undefined)).toBe('')
    expect(bodySnippet('  \n \n')).toBe('')
  })
})

describe('isUnreadFor', () => {
  it('is true only for an open message addressed to the viewer', () => {
    const inbound = message({
      id: 'm1',
      created_by: 'agent-a',
      assignee: 'ben',
    })
    expect(isUnreadFor(inbound, 'ben')).toBe(true)
    // The viewer's own message stays open until its recipient reads it.
    expect(
      isUnreadFor(
        message({ id: 'm2', created_by: 'ben', assignee: 'agent-a' }),
        'ben',
      ),
    ).toBe(false)
    expect(
      isUnreadFor({ ...inbound, status: 'closed' } as typeof inbound, 'ben'),
    ).toBe(false)
  })
})

describe('unreadMessagesFor', () => {
  const conversation = thread('m1', [
    message({ id: 'm1', created_by: 'agent-a', assignee: 'ben' }),
    message({ id: 'm2', created_by: 'ben', assignee: 'agent-a' }),
    message({
      id: 'm3',
      created_by: 'agent-a',
      assignee: 'ben',
      status: 'closed',
    }),
  ])

  it('keeps only open messages addressed to the viewer', () => {
    expect(unreadMessagesFor(conversation, 'ben').map((m) => m.id)).toEqual([
      'm1',
    ])
  })

  it('counts nothing for a viewer who is not a party', () => {
    expect(unreadMessagesFor(conversation, 'someone-else')).toEqual([])
  })
})

describe('summarizeThread', () => {
  it('reads the subject from the root and everything else from the latest message', () => {
    const summary = summarizeThread(
      thread('m1', [
        message({
          id: 'm1',
          title: 'Cache is slow',
          description: 'root body',
          created_by: 'agent-a',
          assignee: 'ben',
          created_at: '2026-01-01T00:00:00Z',
          status: 'closed',
        }),
        message({
          id: 'm2',
          title: 'Re: Cache is slow',
          description: 'latest body',
          created_by: 'agent-a',
          assignee: 'ben',
          created_at: '2026-01-02T00:00:00Z',
        }),
      ]),
      'ben',
    )

    expect(summary).toEqual({
      rootId: 'm1',
      subject: 'Cache is slow',
      sender: 'agent-a',
      snippet: 'latest body',
      latestAt: '2026-01-02T00:00:00Z',
      unreadCount: 1,
      messageCount: 2,
    })
  })

  it('names the recipient when the viewer sent the latest message', () => {
    const summary = summarizeThread(
      thread('m1', [
        message({ id: 'm1', created_by: 'ben', assignee: 'agent-b' }),
      ]),
      'ben',
    )
    expect(summary.sender).toBe('agent-b')
  })

  it('names the sender for agent-to-agent traffic the viewer only watches', () => {
    const summary = summarizeThread(
      thread('m1', [
        message({ id: 'm1', created_by: 'agent-a', assignee: 'agent-b' }),
      ]),
      'ben',
    )
    expect(summary.sender).toBe('agent-a')
    expect(summary.unreadCount).toBe(0)
  })
})
