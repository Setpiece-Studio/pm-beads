// ABOUTME: Unit tests for the inbox activity data layer — mention matching, the pure snapshot
// ABOUTME: filter (comment / open ask / mention), kind precedence, ask ordering, and the window floor.

import { describe, expect, it, vi } from 'vitest'
import { runBdJson } from '../cli'
import {
  ACTIVITY_ITEM_CAP,
  ACTIVITY_WINDOW_DAYS,
  type ActivityIssue,
  type ActivitySnapshot,
  activityWindowStart,
  fetchActivitySnapshotViaSql,
  mentionsViewer,
  selectActivityItems,
} from '../inbox-activity'
import type { Comment } from '../types'

vi.mock('../cli', () => ({ runBdJson: vi.fn() }))

it('preserves object asks from SQL metadata, including invalid asks needing attention', async () => {
  const ask = {
    kind: 'decision',
    q: 'Sign in again?',
    by: 'agent',
    at: '2026-09-18T20:00:00Z',
    default_at: '2026-09-20T20:00:00Z',
  }
  vi.mocked(runBdJson)
    .mockResolvedValueOnce(
      [ask, JSON.stringify(ask), { unexpected: true }].map((value, index) => ({
        id: `issue-${index}`,
        title: 'Reauthenticate',
        status: 'blocked',
        created_at: ask.at,
        metadata: JSON.stringify({ 'ask.reauth': value }),
      })),
    )
    .mockResolvedValueOnce([])
  const snapshot = await fetchActivitySnapshotViaSql('2026-09-01T00:00:00Z')
  expect(
    snapshot.issues.map(({ hasOpenAsk, askDefaultAt }) => ({
      hasOpenAsk,
      askDefaultAt,
    })),
  ).toEqual([
    { hasOpenAsk: true, askDefaultAt: ask.default_at },
    { hasOpenAsk: true, askDefaultAt: ask.default_at },
    { hasOpenAsk: true, askDefaultAt: undefined },
  ])
})

const VIEWER = ['ben', 'Ben Harper']

function issue(
  overrides: Partial<ActivityIssue> & { id: string },
): ActivityIssue {
  return {
    title: `Title for ${overrides.id}`,
    status: 'open',
    description: '',
    createdAt: '2026-08-01T00:00:00Z',
    hasOpenAsk: false,
    ...overrides,
  }
}

function comment(
  overrides: Partial<Comment> & { id: string; issue_id: string },
): Comment {
  return {
    author: 'infra-engineer',
    text: 'a comment',
    created_at: '2026-08-20T10:00:00Z',
    ...overrides,
  }
}

function snapshot(
  issues: ActivityIssue[],
  comments: Comment[],
): ActivitySnapshot {
  return { issues, comments, source: 'sql', truncated: false }
}

const SINCE = '2026-08-01T00:00:00Z'

function select(snap: ActivitySnapshot, since = SINCE) {
  return selectActivityItems(snap, { viewer: VIEWER, since })
}

describe('mentionsViewer', () => {
  it('matches an @alias at a word boundary, case-insensitively', () => {
    expect(mentionsViewer('does this hold, @ben?', VIEWER)).toBe(true)
    expect(mentionsViewer('@BEN please look', VIEWER)).toBe(true)
    expect(mentionsViewer('cc @Ben Harper on this', VIEWER)).toBe(true)
  })

  it('does not match the alias without an @, or as part of a longer handle', () => {
    expect(mentionsViewer('ben should look at this', VIEWER)).toBe(false)
    expect(mentionsViewer('ping @benjamin instead', VIEWER)).toBe(false)
    expect(mentionsViewer('', VIEWER)).toBe(false)
  })
})

describe('activityWindowStart', () => {
  it('is the configured number of days before now', () => {
    const now = new Date('2026-08-27T12:00:00Z')
    const start = new Date(activityWindowStart(now))

    expect((now.getTime() - start.getTime()) / 86_400_000).toBe(
      ACTIVITY_WINDOW_DAYS,
    )
  })
})

describe('selectActivityItems', () => {
  it('keeps a non-viewer comment on an issue the viewer created', () => {
    const items = select(
      snapshot(
        [issue({ id: 'pb-1', createdBy: 'ben', title: 'Cache is slow' })],
        [comment({ id: 'c1', issue_id: 'pb-1', text: 'Profiled it.' })],
      ),
    )

    expect(items).toEqual([
      {
        kind: 'comment',
        id: 'comment:c1',
        issueId: 'pb-1',
        issueTitle: 'Cache is slow',
        issueStatus: 'open',
        actor: 'infra-engineer',
        text: 'Profiled it.',
        createdAt: '2026-08-20T10:00:00Z',
      },
    ])
  })

  it('keeps a non-viewer comment on an issue the viewer is assigned', () => {
    const items = select(
      snapshot(
        [issue({ id: 'pb-1', createdBy: 'agent-x', assignee: 'Ben Harper' })],
        [comment({ id: 'c1', issue_id: 'pb-1' })],
      ),
    )

    expect(items.map((item) => item.id)).toEqual(['comment:c1'])
  })

  it('drops comments the viewer wrote, under any alias', () => {
    const items = select(
      snapshot(
        [issue({ id: 'pb-1', createdBy: 'ben' })],
        [
          comment({ id: 'c1', issue_id: 'pb-1', author: 'ben' }),
          comment({ id: 'c2', issue_id: 'pb-1', author: 'Ben Harper' }),
        ],
      ),
    )

    expect(items).toEqual([])
  })

  it('drops a comment on an issue that is neither the viewer’s nor a mention', () => {
    const items = select(
      snapshot(
        [issue({ id: 'pb-1', createdBy: 'agent-x', assignee: 'agent-y' })],
        [comment({ id: 'c1', issue_id: 'pb-1' })],
      ),
    )

    expect(items).toEqual([])
  })

  it('keeps a mention on an issue the viewer has nothing to do with', () => {
    const items = select(
      snapshot(
        [issue({ id: 'pb-1', createdBy: 'agent-x' })],
        [comment({ id: 'c1', issue_id: 'pb-1', text: 'thoughts @ben?' })],
      ),
    )

    expect(items[0]).toMatchObject({ kind: 'mention', id: 'comment:c1' })
  })

  it('ranks a mention above a plain comment on the viewer’s own issue', () => {
    const items = select(
      snapshot(
        [issue({ id: 'pb-1', createdBy: 'ben' })],
        [comment({ id: 'c1', issue_id: 'pb-1', text: 'over to you @ben' })],
      ),
    )

    expect(items[0]?.kind).toBe('mention')
  })

  it('turns a bead with an open ask into one item, whoever commented last', () => {
    const items = select(
      snapshot(
        [
          issue({
            id: 'pb-1',
            createdBy: 'agent-x',
            hasOpenAsk: true,
            title: 'Pick a rollout order',
          }),
        ],
        [
          comment({
            id: 'c1',
            issue_id: 'pb-1',
            author: 'agent-x',
            text: 'first',
            created_at: '2026-08-20T10:00:00Z',
          }),
          comment({
            id: 'c2',
            issue_id: 'pb-1',
            author: 'infra-engineer',
            text: 'which order do you want? @ben',
            created_at: '2026-08-21T10:00:00Z',
          }),
        ],
      ),
    )

    expect(items).toEqual([
      {
        kind: 'ask',
        id: 'ask:pb-1',
        issueId: 'pb-1',
        issueTitle: 'Pick a rollout order',
        issueStatus: 'open',
        actor: 'infra-engineer',
        text: 'which order do you want? @ben',
        createdAt: '2026-08-21T10:00:00Z',
      },
    ])
  })

  it('falls back to the creator and the description on an ask with no comments', () => {
    const items = select(
      snapshot(
        [
          issue({
            id: 'pb-1',
            createdBy: 'infra-engineer',
            hasOpenAsk: true,
            description: 'Need a call on the schema.',
            createdAt: '2026-08-19T09:00:00Z',
          }),
        ],
        [],
      ),
    )

    expect(items).toEqual([
      {
        kind: 'ask',
        id: 'ask:pb-1',
        issueId: 'pb-1',
        issueTitle: 'Title for pb-1',
        issueStatus: 'open',
        actor: 'infra-engineer',
        text: 'Need a call on the schema.',
        createdAt: '2026-08-19T09:00:00Z',
      },
    ])
  })

  it('drops a closed bead — a closed ask is nobody’s to answer', () => {
    const items = select(
      snapshot(
        [issue({ id: 'pb-1', status: 'closed', hasOpenAsk: true })],
        [comment({ id: 'c1', issue_id: 'pb-1' })],
      ),
    )

    expect(items).toEqual([])
  })

  it('keeps an ask item older than the window — an open ask does not age out', () => {
    const items = select(
      snapshot(
        [
          issue({
            id: 'pb-1',
            hasOpenAsk: true,
            createdBy: 'agent-x',
            createdAt: '2026-01-01T00:00:00Z',
          }),
        ],
        [],
      ),
    )

    expect(items.map((item) => item.id)).toEqual(['ask:pb-1'])
  })

  it('drops comments older than the window floor', () => {
    const items = select(
      snapshot(
        [issue({ id: 'pb-1', createdBy: 'ben' })],
        [
          comment({
            id: 'old',
            issue_id: 'pb-1',
            created_at: '2026-07-01T00:00:00Z',
          }),
          comment({
            id: 'new',
            issue_id: 'pb-1',
            created_at: '2026-08-02T00:00:00Z',
          }),
        ],
      ),
    )

    expect(items.map((item) => item.id)).toEqual(['comment:new'])
  })

  it('drops comments whose issue is not in the snapshot', () => {
    const items = select(
      snapshot([], [comment({ id: 'c1', issue_id: 'gone' })]),
    )

    expect(items).toEqual([])
  })

  it('emits one item for a bead whose ask comment also mentions the viewer', () => {
    const items = select(
      snapshot(
        [issue({ id: 'pb-1', createdBy: 'ben', hasOpenAsk: true })],
        [comment({ id: 'c1', issue_id: 'pb-1', text: 'decision please @ben' })],
      ),
    )

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'ask', id: 'ask:pb-1' })
  })

  it('orders open asks by default_at, soonest first', () => {
    const items = select(
      snapshot(
        [
          issue({
            id: 'pb-late',
            hasOpenAsk: true,
            askDefaultAt: '2026-09-30T00:00:00Z',
            createdAt: '2026-08-25T00:00:00Z',
          }),
          issue({
            id: 'pb-soon',
            hasOpenAsk: true,
            askDefaultAt: '2026-09-20T00:00:00Z',
            createdAt: '2026-08-10T00:00:00Z',
          }),
        ],
        [],
      ),
    )

    expect(items.map((item) => item.id)).toEqual(['ask:pb-soon', 'ask:pb-late'])
    expect(items[0]?.dueAt).toBe('2026-09-20T00:00:00Z')
  })

  it('sorts an ask with no default_at after every dated one, newest first', () => {
    const items = select(
      snapshot(
        [
          issue({
            id: 'pb-undated-old',
            hasOpenAsk: true,
            createdAt: '2026-08-10T00:00:00Z',
          }),
          issue({
            id: 'pb-undated-new',
            hasOpenAsk: true,
            createdAt: '2026-08-25T00:00:00Z',
          }),
          issue({
            id: 'pb-dated',
            hasOpenAsk: true,
            // A date far in the future still outranks having no date at all.
            askDefaultAt: '2027-01-01T00:00:00Z',
            createdAt: '2026-08-01T00:00:00Z',
          }),
        ],
        [],
      ),
    )

    expect(items.map((item) => item.id)).toEqual([
      'ask:pb-dated',
      'ask:pb-undated-new',
      'ask:pb-undated-old',
    ])
    expect(items[1]?.dueAt).toBeUndefined()
  })

  it('puts open asks ahead of newer mentions and comments, so the cap never drops one', () => {
    const comments = Array.from({ length: ACTIVITY_ITEM_CAP + 5 }, (_, index) =>
      comment({
        id: `c${index}`,
        issue_id: 'pb-mine',
        text: 'over to you @ben',
        created_at: `2026-08-${String(2 + Math.floor(index / 100)).padStart(2, '0')}T00:00:${String(index % 60).padStart(2, '0')}Z`,
      }),
    )
    const items = select(
      snapshot(
        [
          issue({ id: 'pb-mine', createdBy: 'ben' }),
          // Older than every comment above, and undated: still the head of the feed.
          issue({
            id: 'pb-ask',
            hasOpenAsk: true,
            createdAt: '2026-01-01T00:00:00Z',
          }),
        ],
        comments,
      ),
    )

    expect(items).toHaveLength(ACTIVITY_ITEM_CAP)
    expect(items[0]?.id).toBe('ask:pb-ask')
  })

  it('orders items newest first and caps the feed', () => {
    const comments = Array.from({ length: ACTIVITY_ITEM_CAP + 5 }, (_, index) =>
      comment({
        id: `c${index}`,
        issue_id: 'pb-1',
        // index 0 is the OLDEST.
        created_at: `2026-08-${String(2 + Math.floor(index / 100)).padStart(2, '0')}T00:00:${String(index % 60).padStart(2, '0')}Z`,
      }),
    )
    const items = select(
      snapshot([issue({ id: 'pb-1', createdBy: 'ben' })], comments),
    )

    expect(items).toHaveLength(ACTIVITY_ITEM_CAP)
    for (let i = 1; i < items.length; i++) {
      expect(
        (items[i - 1] as { createdAt: string }).createdAt >=
          (items[i] as { createdAt: string }).createdAt,
      ).toBe(true)
    }
  })
})
