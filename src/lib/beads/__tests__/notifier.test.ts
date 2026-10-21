// ABOUTME: Unit tests for persona activity routing, prompt deferral, tmux delivery, and dedupe.

import { describe, expect, it, vi } from 'vitest'
import type { ActivityFeed, ActivityItem } from '../inbox-activity'
import {
  notifyProject,
  paneIsAtAgentPrompt,
  type TmuxClient,
} from '../notifier'
import type { NotifierConfig } from '../notifier-store'
import type { Message } from '../types'

const item: ActivityItem = {
  kind: 'mention',
  id: 'comment:c1',
  issueId: 'pb-1',
  issueTitle: 'A bead',
  issueStatus: 'open',
  actor: 'coordinator',
  text: '@Daryl please look',
  createdAt: '2026-08-30T12:00:00Z',
}

function feed(items = [item]): ActivityFeed {
  return {
    items,
    source: 'sql',
    truncated: false,
    since: '2026-08-01T00:00:00Z',
  }
}

function config(deliveredActivityIds: string[] = []): NotifierConfig {
  return {
    personas: { 'data-engineer': { tmux: 'daryl', aliases: ['Daryl'] } },
    deliveredActivityIds,
  }
}

function fakeTmux(capture = 'work complete\n› '): TmuxClient {
  return {
    hasSession: vi.fn(async () => true),
    capturePane: vi.fn(async () => capture),
    sendMessage: vi.fn(async () => {}),
  }
}

function message(patch: Partial<Message> = {}): Message {
  return {
    id: 'pm-beads-wisp-msg1',
    title: 'Please check the deploy',
    description: 'Details',
    status: 'open',
    priority: 2,
    issue_type: 'message',
    assignee: 'data-engineer',
    created_at: '2026-08-30T13:00:00Z',
    created_by: 'coordinator',
    updated_at: '2026-08-30T13:00:00Z',
    ephemeral: true,
    ...patch,
  }
}

const noMessages = async (): Promise<Message[]> => []

describe('paneIsAtAgentPrompt', () => {
  it('recognizes Codex and Claude prompts only on the last visible nonblank line', () => {
    expect(paneIsAtAgentPrompt('done\n› \n')).toBe(true)
    expect(paneIsAtAgentPrompt('done\n❯ \n')).toBe(true)
    expect(paneIsAtAgentPrompt('› old prompt\nWorking…')).toBe(false)
    expect(paneIsAtAgentPrompt('done\n› half-written message')).toBe(false)
  })
})

describe('notifyProject', () => {
  it('uses the persona key and aliases, then wakes the mapped tmux session', async () => {
    const tmux = fakeTmux()
    const readActivity = vi.fn(async () => feed())
    const stamp = vi.fn(async () => {})
    const result = await notifyProject('/project', {
      config: config(),
      readActivity,
      readMessages: noMessages,
      tmux,
      recordDelivered: stamp,
    })

    expect(readActivity).toHaveBeenCalledWith('/project', [
      'data-engineer',
      'Daryl',
    ])
    expect(tmux.sendMessage).toHaveBeenCalledWith(
      'daryl',
      'New comment from coordinator on pb-1. Read it.',
    )
    expect(stamp).toHaveBeenCalledWith('/project', 'comment:c1')
    expect(result.delivered).toEqual(['comment:c1'])
  })

  it('routes a reply on the persona own bead from the shared activity selector', async () => {
    const reply = { ...item, kind: 'comment' as const, text: 'I answered it.' }
    const tmux = fakeTmux()
    await notifyProject('/project', {
      config: config(),
      readActivity: async (_dir, viewer) => {
        expect(viewer).toContain('data-engineer')
        return feed([reply])
      },
      readMessages: noMessages,
      tmux,
      recordDelivered: async () => {},
    })
    expect(tmux.sendMessage).toHaveBeenCalledOnce()
  })

  it('defers without stamping when the pane is mid-turn or the session is absent', async () => {
    for (const tmux of [
      fakeTmux('Thinking…'),
      { ...fakeTmux(), hasSession: vi.fn(async () => false) },
    ]) {
      const stamp = vi.fn(async () => {})
      const result = await notifyProject('/project', {
        config: config(),
        readActivity: async () => feed(),
        readMessages: noMessages,
        tmux,
        recordDelivered: stamp,
      })
      expect(result.deferred).toEqual(['comment:c1'])
      expect(stamp).not.toHaveBeenCalled()
      expect(tmux.sendMessage).not.toHaveBeenCalled()
    }
  })

  it('does not deliver an activity id already in the ledger', async () => {
    const tmux = fakeTmux()
    await notifyProject('/project', {
      config: config(['comment:c1']),
      readActivity: async () => feed(),
      readMessages: noMessages,
      tmux,
      recordDelivered: async () => {},
    })
    expect(tmux.hasSession).not.toHaveBeenCalled()
  })

  it('ignores mention-only personas with no tmux route', async () => {
    const tmux = fakeTmux()
    await notifyProject('/project', {
      config: {
        personas: { cpo: { aliases: ['CPO'] } },
        deliveredActivityIds: [],
      },
      readActivity: async () => feed(),
      readMessages: noMessages,
      tmux,
      recordDelivered: async () => {},
    })
    expect(tmux.hasSession).not.toHaveBeenCalled()
  })

  it('wakes a persona for an unread direct message addressed by alias', async () => {
    const tmux = fakeTmux()
    const stamp = vi.fn(async () => {})
    const readMessages = vi.fn(async () => [message({ assignee: 'DARYL' })])
    const result = await notifyProject('/project', {
      config: config(),
      readActivity: async () => feed([]),
      readMessages,
      tmux,
      recordDelivered: stamp,
    })

    expect(readMessages).toHaveBeenCalledWith('/project')
    expect(tmux.sendMessage).toHaveBeenCalledWith(
      'daryl',
      'New message from coordinator (pm-beads-wisp-msg1). Read it.',
    )
    expect(stamp).toHaveBeenCalledWith('/project', 'message:pm-beads-wisp-msg1')
    expect(result.delivered).toEqual(['message:pm-beads-wisp-msg1'])
  })

  it('ignores messages for other recipients and acknowledgment receipts', async () => {
    const tmux = fakeTmux()
    const result = await notifyProject('/project', {
      config: config(),
      readActivity: async () => feed([]),
      readMessages: async () => [
        message({ id: 'for-someone-else', assignee: 'coordinator' }),
        message({
          id: 'ack',
          metadata: { message_kind: 'ack', comment_id: 'comment-1' },
        }),
      ],
      tmux,
      recordDelivered: async () => {},
    })

    expect(result).toEqual({ delivered: [], deferred: [] })
    expect(tmux.hasSession).not.toHaveBeenCalled()
  })

  it('does not redeliver a direct message already in the ledger', async () => {
    const tmux = fakeTmux()
    await notifyProject('/project', {
      config: config(['message:pm-beads-wisp-msg1']),
      readActivity: async () => feed([]),
      readMessages: async () => [message()],
      tmux,
      recordDelivered: async () => {},
    })

    expect(tmux.hasSession).not.toHaveBeenCalled()
  })

  it('still delivers mentions when the message read fails', async () => {
    const tmux = fakeTmux()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await notifyProject('/project', {
      config: config(),
      readActivity: async () => feed(),
      readMessages: async () => {
        throw new Error('messages unavailable')
      },
      tmux,
      recordDelivered: async () => {},
    })

    expect(result.delivered).toEqual(['comment:c1'])
    expect(tmux.sendMessage).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(
      '[pm-beads] notifier could not read messages for /project: messages unavailable',
    )
  })
})
