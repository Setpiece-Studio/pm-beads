// ABOUTME: Unit tests for the PR-history backfill's PURE half — prefix detection, bead-id
// ABOUTME: extraction and its confidence tiers, and the proposal plan's filters and ordering.

import { describe, expect, it } from 'vitest'
import { askMetadataKey, serializeAsk } from '../asks'
import {
  BACKFILL_DEFAULT_DAYS,
  type BackfillIssue,
  type BackfillProposal,
  backfillAction,
  backfillSince,
  beadIdPrefix,
  extractBeadIds,
  type HistoryPr,
  planBackfill,
} from '../pr-backfill'

const REPO = 'https://github.com/o/r'

const OPEN_ASK = serializeAsk({
  kind: 'decision',
  q: 'Renderer or exporter first?',
  by: 'coordinator',
  at: '2026-08-19T10:00:00.000Z',
})

function pr(overrides: Partial<HistoryPr> = {}): HistoryPr {
  return {
    number: 7,
    url: `${REPO}/pull/7`,
    title: 'Some pull request',
    body: '',
    headRefName: 'some-branch',
    mergedAt: '2026-08-20T12:00:00Z',
    ...overrides,
  }
}

function issue(overrides: Partial<BackfillIssue> = {}): BackfillIssue {
  return {
    id: 'pm-beads-1',
    title: 'A bead',
    status: 'open',
    issue_type: 'task',
    ...overrides,
  }
}

describe('beadIdPrefix', () => {
  it('reads the prefix off the project ids, dashes and all', () => {
    expect(beadIdPrefix(['pm-beads-s52', 'pm-beads-mjw'])).toBe('pm-beads-')
    expect(beadIdPrefix(['sc-1', 'sc-2', 'sc-3'])).toBe('sc-')
    expect(beadIdPrefix(['sample_project-9a'])).toBe('sample_project-')
  })

  it('takes the prefix the most ids agree on, so one stray import cannot win', () => {
    expect(beadIdPrefix(['sc-1', 'sc-2', 'sc-3', 'other-1', 'other-2'])).toBe(
      'sc-',
    )
  })

  it('sees through a dotted legacy id', () => {
    expect(beadIdPrefix(['bd-1.1', 'bd-1.2', 'bd-2'])).toBe('bd-')
  })

  it('is null when there is nothing to read a prefix from', () => {
    expect(beadIdPrefix([])).toBeNull()
    expect(beadIdPrefix(['nodashes'])).toBeNull()
  })
})

describe('extractBeadIds', () => {
  const prefix = 'pm-beads-'

  it('is high confidence for a closing keyword in the body', () => {
    for (const keyword of ['Closes', 'closes', 'Fixes', 'FIXES', 'Resolves']) {
      expect(
        extractBeadIds(pr({ body: `${keyword} pm-beads-s52` }), prefix),
      ).toEqual([{ id: 'pm-beads-s52', confidence: 'high' }])
    }
  })

  it('accepts the colon form and extra spacing after the keyword', () => {
    for (const body of [
      'Closes: pm-beads-s52',
      'Closes:pm-beads-s52',
      'closes   pm-beads-s52',
      'Fixes : pm-beads-s52',
    ]) {
      expect(extractBeadIds(pr({ body }), prefix)).toEqual([
        { id: 'pm-beads-s52', confidence: 'high' },
      ])
    }
  })

  it('does not treat a keyword glued to the id as a closing line', () => {
    expect(extractBeadIds(pr({ body: 'Closespm-beads-s52' }), prefix)).toEqual(
      [],
    )
  })

  it('is medium confidence from the title or the branch name', () => {
    expect(
      extractBeadIds(
        pr({ title: 'pm-beads-s52: backfill review list' }),
        prefix,
      ),
    ).toEqual([{ id: 'pm-beads-s52', confidence: 'medium' }])
    expect(
      extractBeadIds(pr({ headRefName: 'feat/pm-beads-s52-backfill' }), prefix),
    ).toEqual([{ id: 'pm-beads-s52', confidence: 'medium' }])
  })

  it('is low confidence for a bare mention in the body', () => {
    expect(
      extractBeadIds(pr({ body: 'Follows on from pm-beads-j9y.' }), prefix),
    ).toEqual([{ id: 'pm-beads-j9y', confidence: 'low' }])
  })

  it('takes the strongest tier when an id appears in several places', () => {
    expect(
      extractBeadIds(
        pr({
          title: 'pm-beads-s52 backfill',
          headRefName: 'pm-beads-s52',
          body: 'Closes pm-beads-s52\n\nSee also pm-beads-s52 above.',
        }),
        prefix,
      ),
    ).toEqual([{ id: 'pm-beads-s52', confidence: 'high' }])
  })

  it('orders by confidence then id, so a scan is reproducible', () => {
    expect(
      extractBeadIds(
        pr({
          title: 'pm-beads-b2 and pm-beads-b1',
          body: 'Closes pm-beads-a9\nAlso mentions pm-beads-c1 and pm-beads-c0.',
        }),
        prefix,
      ),
    ).toEqual([
      { id: 'pm-beads-a9', confidence: 'high' },
      { id: 'pm-beads-b1', confidence: 'medium' },
      { id: 'pm-beads-b2', confidence: 'medium' },
      { id: 'pm-beads-c0', confidence: 'low' },
      { id: 'pm-beads-c1', confidence: 'low' },
    ])
  })

  it('matches a dotted legacy id whole', () => {
    expect(extractBeadIds(pr({ body: 'Closes pm-beads-x.1' }), prefix)).toEqual(
      [{ id: 'pm-beads-x.1', confidence: 'high' }],
    )
    // The trailing period ends the sentence; it is not part of the id.
    expect(extractBeadIds(pr({ body: 'Fixes pm-beads-x.1.' }), prefix)).toEqual(
      [{ id: 'pm-beads-x.1', confidence: 'high' }],
    )
  })

  it('takes the longest id at a prefix boundary — pm-beads-10, never pm-beads-1', () => {
    expect(extractBeadIds(pr({ body: 'Closes pm-beads-10' }), prefix)).toEqual([
      { id: 'pm-beads-10', confidence: 'high' },
    ])
  })

  it('does not match a prefix glued to a longer word', () => {
    expect(
      extractBeadIds(pr({ body: 'see xpm-beads-1 there' }), prefix),
    ).toEqual([])
    expect(extractBeadIds(pr({ body: 'see old-pm-beads-1' }), prefix)).toEqual(
      [],
    )
  })

  it('lowercases what it found, since bd ids are lowercase', () => {
    expect(extractBeadIds(pr({ body: 'Closes PM-BEADS-S52' }), prefix)).toEqual(
      [{ id: 'pm-beads-s52', confidence: 'high' }],
    )
  })

  it('ignores another project prefix entirely', () => {
    expect(extractBeadIds(pr({ body: 'Closes sc-14' }), prefix)).toEqual([])
  })
})

describe('planBackfill', () => {
  const prefix = 'pm-beads-'

  function plan(input: {
    issues: BackfillIssue[]
    prs: HistoryPr[]
    skippedIds?: string[]
  }): BackfillProposal[] {
    return planBackfill({ ...input, prefix })
  }

  it('proposes set-pr-url plus close for a plain open bead', () => {
    expect(
      plan({
        issues: [issue({ id: 'pm-beads-a1', title: 'Rail row' })],
        prs: [
          pr({
            number: 42,
            url: `${REPO}/pull/42`,
            body: 'Closes pm-beads-a1',
          }),
        ],
      }),
    ).toEqual([
      {
        id: 'pm-beads-a1',
        title: 'Rail row',
        status: 'open',
        issue_type: 'task',
        prUrl: `${REPO}/pull/42`,
        prNumber: 42,
        prTitle: 'Some pull request',
        mergedAt: '2026-08-20T12:00:00Z',
        confidence: 'high',
        actions: ['set-pr-url', 'close'],
      },
    ])
  })

  it('proposes comment-only for an epic and for a bead with an open ask', () => {
    const proposals = plan({
      issues: [
        issue({ id: 'pm-beads-e1', issue_type: 'epic' }),
        issue({
          id: 'pm-beads-h1',
          metadata: { [askMetadataKey('rollout')]: OPEN_ASK },
        }),
        // The retired label on its own no longer holds a bead open.
        issue({ id: 'pm-beads-h2', labels: ['Human'] }),
      ],
      prs: [pr({ body: 'Closes pm-beads-e1, pm-beads-h1 and pm-beads-h2' })],
    })
    expect(proposals.map((p) => [p.id, p.actions])).toEqual([
      ['pm-beads-e1', ['set-pr-url', 'comment-only']],
      ['pm-beads-h1', ['set-pr-url', 'comment-only']],
      ['pm-beads-h2', ['set-pr-url', 'close']],
    ])
  })

  it('skips ids that do not exist in the project', () => {
    expect(
      plan({ issues: [], prs: [pr({ body: 'Closes pm-beads-ghost' })] }),
    ).toEqual([])
  })

  it('skips beads that are already closed', () => {
    expect(
      plan({
        issues: [issue({ id: 'pm-beads-a1', status: 'closed' })],
        prs: [pr({ body: 'Closes pm-beads-a1' })],
      }),
    ).toEqual([])
  })

  it('skips a bead already linked to this very PR', () => {
    expect(
      plan({
        issues: [issue({ id: 'pm-beads-a1', prUrl: `${REPO}/pull/42/files` })],
        prs: [
          pr({
            number: 42,
            url: `${REPO}/pull/42`,
            body: 'Closes pm-beads-a1',
          }),
        ],
      }),
    ).toEqual([])
  })

  it('proposes an update, never a close, when the bead points at a different PR', () => {
    const [proposal] = plan({
      issues: [issue({ id: 'pm-beads-a1', prUrl: `${REPO}/pull/9` })],
      prs: [
        pr({ number: 42, url: `${REPO}/pull/42`, body: 'Closes pm-beads-a1' }),
      ],
    })
    expect(proposal.actions).toEqual(['set-pr-url', 'comment-only'])
    expect(proposal.previousPrUrl).toBe(`${REPO}/pull/9`)
  })

  it('skips ids the sidecar remembers being skipped', () => {
    expect(
      plan({
        issues: [issue({ id: 'pm-beads-a1' })],
        prs: [pr({ body: 'Closes pm-beads-a1' })],
        skippedIds: ['PM-BEADS-A1'],
      }),
    ).toEqual([])
  })

  it('keeps one proposal per bead — the strongest, then the most recent merge', () => {
    const proposals = plan({
      issues: [issue({ id: 'pm-beads-a1' })],
      prs: [
        pr({
          number: 1,
          url: `${REPO}/pull/1`,
          body: 'Closes pm-beads-a1',
          mergedAt: '2026-01-01T00:00:00Z',
        }),
        pr({
          number: 2,
          url: `${REPO}/pull/2`,
          title: 'pm-beads-a1 later but weaker',
          mergedAt: '2026-08-01T00:00:00Z',
        }),
      ],
    })
    expect(proposals).toHaveLength(1)
    expect(proposals[0].prNumber).toBe(1)
    expect(proposals[0].confidence).toBe('high')
  })

  it('orders by confidence, then newest merge, then id', () => {
    const proposals = plan({
      issues: [
        issue({ id: 'pm-beads-a1' }),
        issue({ id: 'pm-beads-a2' }),
        issue({ id: 'pm-beads-b1' }),
        issue({ id: 'pm-beads-b2' }),
      ],
      prs: [
        pr({
          number: 1,
          url: `${REPO}/pull/1`,
          body: 'Closes pm-beads-a2',
          mergedAt: '2026-02-01T00:00:00Z',
        }),
        pr({
          number: 2,
          url: `${REPO}/pull/2`,
          body: 'Closes pm-beads-a1',
          mergedAt: '2026-08-01T00:00:00Z',
        }),
        pr({
          number: 3,
          url: `${REPO}/pull/3`,
          title: 'pm-beads-b1',
          mergedAt: '2026-07-01T00:00:00Z',
        }),
        pr({
          number: 4,
          url: `${REPO}/pull/4`,
          body: 'mentions pm-beads-b2',
          mergedAt: '2026-09-01T00:00:00Z',
        }),
      ],
    })
    expect(proposals.map((p) => p.id)).toEqual([
      'pm-beads-a1',
      'pm-beads-a2',
      'pm-beads-b1',
      'pm-beads-b2',
    ])
    expect(proposals.map((p) => p.confidence)).toEqual([
      'high',
      'high',
      'medium',
      'low',
    ])
  })
})

describe('backfillAction', () => {
  const base: BackfillProposal = {
    id: 'pm-beads-a1',
    title: 'Rail row',
    status: 'open',
    issue_type: 'task',
    prUrl: `${REPO}/pull/42`,
    prNumber: 42,
    prTitle: 'Ship the rail row',
    mergedAt: '2026-08-20T12:00:00Z',
    confidence: 'high',
    actions: ['set-pr-url', 'close'],
  }

  it('closes with the sweep-shaped comment and reason, marked as a backfill', () => {
    expect(backfillAction(base)).toEqual({
      id: 'pm-beads-a1',
      prUrl: `${REPO}/pull/42`,
      prNumber: 42,
      mergedAt: '2026-08-20T12:00:00Z',
      kind: 'close',
      comment: `Closed: PR #42 merged ${REPO}/pull/42 — backfilled from PR history (high confidence)`,
      closeReason: 'PR #42 merged',
    })
  })

  it('says why a comment-only bead was not closed', () => {
    const action = backfillAction({
      ...base,
      confidence: 'medium',
      actions: ['set-pr-url', 'comment-only'],
    })
    expect(action.kind).toBe('comment-only')
    expect(action.comment).toBe(
      `PR #42 merged ${REPO}/pull/42 — backfilled from PR history (medium confidence); not auto-closed (epic / open ask)`,
    )
    expect(action.closeReason).toBeUndefined()
  })

  it('names the pull request it replaced when the bead already had one', () => {
    const action = backfillAction({
      ...base,
      actions: ['set-pr-url', 'comment-only'],
      previousPrUrl: `${REPO}/pull/9`,
    })
    expect(action.comment).toBe(
      `PR #42 merged ${REPO}/pull/42 — backfilled from PR history (high confidence); pr_url updated from ${REPO}/pull/9`,
    )
  })
})

describe('backfillSince', () => {
  const now = new Date('2026-08-27T12:00:00Z')

  it('counts back the requested number of days', () => {
    expect(backfillSince(30, now).toISOString()).toBe(
      '2026-07-28T12:00:00.000Z',
    )
  })

  it('defaults to the six-month window', () => {
    expect(BACKFILL_DEFAULT_DAYS).toBe(180)
    expect(backfillSince(undefined, now).getTime()).toBe(
      now.getTime() - BACKFILL_DEFAULT_DAYS * 24 * 60 * 60 * 1000,
    )
  })

  it('clamps junk and out-of-range input rather than asking GitHub for everything', () => {
    expect(backfillSince(0, now).getTime()).toBeLessThan(now.getTime())
    expect(backfillSince(-5, now)).toEqual(backfillSince(1, now))
    expect(backfillSince(99_999, now)).toEqual(backfillSince(3650, now))
    expect(backfillSince(Number.NaN, now)).toEqual(
      backfillSince(BACKFILL_DEFAULT_DAYS, now),
    )
  })
})
