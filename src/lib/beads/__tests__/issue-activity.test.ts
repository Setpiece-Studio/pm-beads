// ABOUTME: Unit coverage for getIssueActivity — the bd history + comments read behind the
// ABOUTME: activity stream, including the comments-only degradation when bd history crashes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearBdCachesForTest } from '../cache'
import { getIssueActivity } from '../queries'
import type { HistoryEntry } from '../types'

const cliMocks = vi.hoisted(() => ({
  runBdJson: vi.fn(),
}))

vi.mock('../cli', () => ({
  beadsProjectDir: () => '/default/project',
  runBd: vi.fn(),
  runBdJson: cliMocks.runBdJson,
  runBdWrite: vi.fn(),
  runBdWriteJson: vi.fn(),
}))

const COMMENT = {
  id: 'c1',
  issue_id: 'pm-1',
  author: 'Marty',
  text: 'on it',
  created_at: '2026-06-01T10:05:00Z',
}

function historyEntry(patch: Record<string, unknown> = {}): HistoryEntry {
  return {
    CommitHash: 'hash0',
    Committer: 'root',
    CommitDate: '2026-06-01T10:00:00Z',
    Issue: {
      id: 'pm-1',
      title: 'Fix the flux capacitor',
      description: '',
      status: 'open',
      priority: 2,
      issue_type: 'task',
      created_at: '2026-06-01T10:00:00Z',
      created_by: 'Doc Brown',
      updated_at: '2026-06-01T10:00:00Z',
      ...patch,
    },
  }
}

/** Route the two reads getIssueActivity makes by their bd subcommand. */
function mockBd(
  history: () => unknown,
  comments: unknown = [COMMENT],
  messages: unknown = [],
) {
  cliMocks.runBdJson.mockImplementation((args: string[]) => {
    if (args[0] === 'history') return Promise.resolve(history())
    if (args[0] === 'comments') return Promise.resolve(comments)
    if (args[0] === 'list') return Promise.resolve(messages)
    throw new Error(`unexpected bd call: ${args.join(' ')}`)
  })
}

describe('getIssueActivity', () => {
  beforeEach(() => {
    cliMocks.runBdJson.mockReset()
    clearBdCachesForTest()
  })

  it('returns derived events alongside comments when bd history succeeds', async () => {
    mockBd(() => [
      historyEntry({
        status: 'in_progress',
        updated_at: '2026-06-01T10:10:00Z',
      }),
      historyEntry(),
    ])
    const activity = await getIssueActivity('pm-1')

    expect(activity.historyUnavailable).toBe(false)
    expect(activity.events.map((event) => event.kind)).toEqual([
      'created',
      'status',
    ])
    expect(activity.comments).toEqual([COMMENT])
    expect(activity.messages).toEqual([])
  })

  it('includes read or unread messages related to the work bead', async () => {
    const related = {
      id: 'pm-wisp-ack',
      title: 'Acknowledged response',
      description: 'Acknowledged comment:c1',
      status: 'closed',
      priority: 2,
      issue_type: 'message',
      ephemeral: true,
      created_at: '2026-06-01T10:06:00Z',
      updated_at: '2026-06-01T10:06:00Z',
      metadata: { message_kind: 'ack', comment_id: 'c1' },
      dependencies: [
        {
          issue_id: 'pm-wisp-ack',
          depends_on_id: 'pm-1',
          type: 'relates-to',
        },
      ],
    }
    mockBd(() => [historyEntry()], [COMMENT], [related])
    const activity = await getIssueActivity('pm-1')
    expect(activity.messages).toEqual([related])
  })

  it('degrades to a comments-only stream when bd history hits the NULL description bug', async () => {
    // bd 1.2.2 still crashes on legacy rows whose description is SQL NULL (pm-beads-574).
    // The stream must survive it: comments render, events are empty, and the caller is told.
    mockBd(() => {
      throw new Error(
        'Error: failed to get issue history: sql: Scan error on column index 2, name "description": converting NULL to string is unsupported',
      )
    })
    const activity = await getIssueActivity('pm-1')

    expect(activity.historyUnavailable).toBe(true)
    expect(activity.events).toEqual([])
    expect(activity.comments).toEqual([COMMENT])
  })

  it('degrades rather than throwing when bd history returns unparseable JSON', async () => {
    mockBd(() => [{ nope: true }])
    const activity = await getIssueActivity('pm-1')

    expect(activity.historyUnavailable).toBe(true)
    expect(activity.comments).toEqual([COMMENT])
  })

  it('still propagates a comments read failure — that one is not degradable', async () => {
    cliMocks.runBdJson.mockImplementation((args: string[]) => {
      if (args[0] === 'history') return Promise.resolve([historyEntry()])
      return Promise.reject(new Error('bd: database locked'))
    })
    await expect(getIssueActivity('pm-1')).rejects.toThrow('database locked')
  })
})
