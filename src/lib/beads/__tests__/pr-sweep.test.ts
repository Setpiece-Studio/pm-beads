// ABOUTME: Unit tests for the merged-PR sweep's pure half — the plan (close vs comment-only vs
// ABOUTME: skip), the repo grouping, and the since/safety-margin window.

import { describe, expect, it } from 'vitest'
import { type AskValue, askMetadataKey, serializeAsk } from '../asks'
import {
  candidateFromIssue,
  groupPrUrlsByRepo,
  type MergedPr,
  mergedSearchDate,
  planSweep,
  type SweepCandidate,
  sweepSince,
} from '../pr-sweep'
import type { Issue } from '../types'

const PR_42 = 'https://github.com/e2e-owner/e2e-repo/pull/42'
const PR_43 = 'https://github.com/e2e-owner/e2e-repo/pull/43'
const PR_7 = 'https://github.com/other-owner/other-repo/pull/7'

const ask: AskValue = {
  kind: 'decision',
  q: 'Renderer or exporter first?',
  by: 'coordinator',
  at: '2026-08-19T10:00:00.000Z',
}
const OPEN_ASK = serializeAsk(ask)
const ANSWERED_ASK = serializeAsk({
  ...ask,
  answer: 'renderer',
  answered_by: 'ben',
  answered_at: '2026-08-20T09:00:00.000Z',
})

function merged(
  url: string,
  number: number,
  mergedAt = '2026-08-20T10:00:00Z',
): MergedPr {
  return { url, number, mergedAt }
}

function candidate(overrides: Partial<SweepCandidate> = {}): SweepCandidate {
  return {
    id: 'tst-1',
    issue_type: 'task',
    status: 'open',
    prUrl: PR_42,
    ...overrides,
  }
}

describe('planSweep', () => {
  it('closes a plain open issue whose PR merged', () => {
    const plan = planSweep([candidate()], [merged(PR_42, 42)])

    expect(plan.skipped).toEqual([])
    expect(plan.actions).toEqual([
      {
        id: 'tst-1',
        prUrl: PR_42,
        prNumber: 42,
        mergedAt: '2026-08-20T10:00:00Z',
        kind: 'close',
        comment: `Closed: PR #42 merged ${PR_42}`,
        closeReason: 'PR #42 merged',
      },
    ])
  })

  it('closes an in_progress issue too', () => {
    const plan = planSweep(
      [candidate({ status: 'in_progress' })],
      [merged(PR_42, 42)],
    )
    expect(plan.actions.map((a) => a.kind)).toEqual(['close'])
  })

  it('only comments on an epic', () => {
    const plan = planSweep(
      [candidate({ issue_type: 'epic' })],
      [merged(PR_42, 42)],
    )

    expect(plan.actions).toEqual([
      {
        id: 'tst-1',
        prUrl: PR_42,
        prNumber: 42,
        mergedAt: '2026-08-20T10:00:00Z',
        kind: 'comment-only',
        comment: `PR #42 merged ${PR_42} — not auto-closed (epic / open ask)`,
      },
    ])
  })

  it('only comments on an issue carrying an unanswered ask', () => {
    const plan = planSweep(
      [candidate({ metadata: { [askMetadataKey('rollout')]: OPEN_ASK } })],
      [merged(PR_42, 42)],
    )
    expect(plan.actions.map((a) => a.kind)).toEqual(['comment-only'])
  })

  it('closes an issue whose asks have all been answered', () => {
    const plan = planSweep(
      [candidate({ metadata: { [askMetadataKey('rollout')]: ANSWERED_ASK } })],
      [merged(PR_42, 42)],
    )
    expect(plan.actions.map((a) => a.kind)).toEqual(['close'])
  })

  it('only comments when the ask metadata cannot be read', () => {
    const plan = planSweep(
      [candidate({ metadata: { 'ask.rollout': '{' } })],
      [merged(PR_42, 42)],
    )
    expect(plan.actions.map((a) => a.kind)).toEqual(['comment-only'])
  })

  it('closes an issue that merely carries the retired human label', () => {
    const plan = planSweep(
      [candidate({ labels: ['frontend', 'human'] })],
      [merged(PR_42, 42)],
    )
    expect(plan.actions.map((a) => a.kind)).toEqual(['close'])
  })

  it('skips a closed issue without touching it', () => {
    const plan = planSweep(
      [candidate({ status: 'closed' })],
      [merged(PR_42, 42)],
    )

    expect(plan.actions).toEqual([])
    expect(plan.skipped).toEqual([
      { id: 'tst-1', prUrl: PR_42, reason: 'closed' },
    ])
  })

  it('skips a status that is neither open nor in_progress', () => {
    const plan = planSweep(
      [candidate({ status: 'blocked' })],
      [merged(PR_42, 42)],
    )
    expect(plan.skipped).toEqual([
      { id: 'tst-1', prUrl: PR_42, reason: 'not-open' },
    ])
  })

  it('skips an issue whose PR is not in the merged set', () => {
    const plan = planSweep([candidate()], [merged(PR_43, 43)])
    expect(plan.actions).toEqual([])
    expect(plan.skipped).toEqual([
      { id: 'tst-1', prUrl: PR_42, reason: 'not-merged' },
    ])
  })

  it('skips a pr_url that is not a GitHub pull request url', () => {
    const plan = planSweep(
      [candidate({ prUrl: 'https://example.com/nope' })],
      [merged(PR_42, 42)],
    )
    expect(plan.skipped).toEqual([
      {
        id: 'tst-1',
        prUrl: 'https://example.com/nope',
        reason: 'invalid-pr-url',
      },
    ])
  })

  it('matches a stored url that differs in case, trailing slash, or deep path', () => {
    const stored = 'http://www.GitHub.com/e2e-owner/e2e-repo/pull/42/files'
    const plan = planSweep([candidate({ prUrl: stored })], [merged(PR_42, 42)])
    expect(plan.actions.map((a) => a.kind)).toEqual(['close'])
    // The comment quotes the CANONICAL url, not whatever shape was stored.
    expect(plan.actions[0].comment).toContain(PR_42)
  })

  it('orders actions and skips by issue id, whatever order the candidates arrive in', () => {
    const plan = planSweep(
      [
        candidate({ id: 'tst-3' }),
        candidate({ id: 'tst-1' }),
        candidate({ id: 'tst-2', prUrl: PR_43 }),
        candidate({ id: 'tst-9', status: 'closed' }),
        candidate({ id: 'tst-4', status: 'closed' }),
      ],
      [merged(PR_42, 42)],
    )

    expect(plan.actions.map((a) => a.id)).toEqual(['tst-1', 'tst-3'])
    expect(plan.skipped.map((s) => s.id)).toEqual(['tst-2', 'tst-4', 'tst-9'])
  })
})

describe('candidateFromIssue', () => {
  const issue: Issue = {
    id: 'tst-1',
    title: 'A bead',
    status: 'open',
    priority: 1,
    issue_type: 'task',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    metadata: { pr_url: PR_42 },
  }

  it('carries the id, type, status, labels, title, metadata, and pr_url across', () => {
    expect(candidateFromIssue({ ...issue, labels: ['frontend'] })).toEqual({
      id: 'tst-1',
      title: 'A bead',
      issue_type: 'task',
      status: 'open',
      labels: ['frontend'],
      metadata: { pr_url: PR_42 },
      prUrl: PR_42,
    })
  })

  it('carries ask metadata across, so the plan can read the bead’s open asks', () => {
    const metadata = { pr_url: PR_42, [askMetadataKey('rollout')]: OPEN_ASK }
    expect(candidateFromIssue({ ...issue, metadata })?.metadata).toEqual(
      metadata,
    )
  })

  it('is null for an issue with no pr_url', () => {
    expect(candidateFromIssue({ ...issue, metadata: undefined })).toBeNull()
  })
})

describe('groupPrUrlsByRepo', () => {
  it('groups by owner/repo, deduped, in repo order', () => {
    expect(groupPrUrlsByRepo([PR_7, PR_43, PR_42, PR_42])).toEqual([
      { repo: 'e2e-owner/e2e-repo', numbers: [42, 43] },
      { repo: 'other-owner/other-repo', numbers: [7] },
    ])
  })

  it('drops urls that are not pull requests', () => {
    expect(groupPrUrlsByRepo(['nonsense', PR_42])).toEqual([
      { repo: 'e2e-owner/e2e-repo', numbers: [42] },
    ])
  })

  it('normalizes owner/repo case so one repo is queried once', () => {
    expect(
      groupPrUrlsByRepo([
        PR_42,
        'https://github.com/E2E-Owner/E2E-Repo/pull/43',
      ]),
    ).toEqual([{ repo: 'e2e-owner/e2e-repo', numbers: [42, 43] }])
  })
})

describe('sweepSince', () => {
  const now = new Date('2026-08-27T12:00:00Z')

  it('looks back 30 days on a first run', () => {
    expect(sweepSince(undefined, now).toISOString()).toBe(
      '2026-07-28T12:00:00.000Z',
    )
  })

  it('backs the last successful run off by a one-day safety margin', () => {
    expect(sweepSince('2026-08-26T09:00:00Z', now).toISOString()).toBe(
      '2026-08-25T09:00:00.000Z',
    )
  })

  it('falls back to the first-run window when the stored timestamp is junk', () => {
    expect(sweepSince('not-a-date', now).toISOString()).toBe(
      '2026-07-28T12:00:00.000Z',
    )
  })

  it('never looks further back than the first-run window', () => {
    expect(sweepSince('2020-01-01T00:00:00Z', now).toISOString()).toBe(
      '2026-07-28T12:00:00.000Z',
    )
  })

  it('clamps a future timestamp to now, so a clock skew never searches forward', () => {
    expect(sweepSince('2030-01-01T00:00:00Z', now).toISOString()).toBe(
      now.toISOString(),
    )
  })
})

describe('mergedSearchDate', () => {
  it('renders the UTC calendar date gh search understands', () => {
    expect(mergedSearchDate(new Date('2026-08-25T23:30:00Z'))).toBe(
      '2026-08-25',
    )
  })
})
