// ABOUTME: Unit tests for the unresolved-blocker predicate — open vs closed blockers, mixed
// ABOUTME: blockers, absent (cross-project) blockers, non-blocks edges, and literal blocked status.

import { describe, expect, it } from 'vitest'
import {
  buildBlockedIds,
  buildStatusMap,
  hasUnresolvedBlocker,
} from '../blocked'
import type { Dependency, Issue } from '../types'

let seq = 0
function issue(overrides: Partial<Issue> = {}): Issue {
  seq += 1
  return {
    id: `t-${seq}`,
    title: `Issue ${seq}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-15T00:00:00Z',
    updated_at: '2026-06-15T00:00:00Z',
    ...overrides,
  }
}

// A bd list dependency edge: `issue_id` owns the edge, `depends_on_id` is the blocker.
function edge(ownerId: string, blockerId: string, type: string): Dependency {
  return { issue_id: ownerId, depends_on_id: blockerId, type }
}

describe('buildStatusMap', () => {
  it('maps every loaded issue id to its status', () => {
    const a = issue({ id: 'a', status: 'open' })
    const b = issue({ id: 'b', status: 'closed' })
    const map = buildStatusMap([a, b])
    expect(map.get('a')).toBe('open')
    expect(map.get('b')).toBe('closed')
    expect(map.get('missing')).toBeUndefined()
  })
})

describe('hasUnresolvedBlocker', () => {
  it('flags an issue whose blocks edge points at an open blocker', () => {
    const blocker = issue({ id: 'blk', status: 'open' })
    const blocked = issue({
      id: 'me',
      dependencies: [edge('me', 'blk', 'blocks')],
    })
    const map = buildStatusMap([blocker, blocked])
    expect(hasUnresolvedBlocker(blocked, map)).toBe(true)
  })

  it('does not flag an issue whose only blocker is closed (resolved)', () => {
    const blocker = issue({ id: 'blk', status: 'closed' })
    const blocked = issue({
      id: 'me',
      dependencies: [edge('me', 'blk', 'blocks')],
    })
    const map = buildStatusMap([blocker, blocked])
    expect(hasUnresolvedBlocker(blocked, map)).toBe(false)
  })

  it('flags an issue with two blockers when one is still open', () => {
    const open = issue({ id: 'open-blk', status: 'open' })
    const closed = issue({ id: 'closed-blk', status: 'closed' })
    const blocked = issue({
      id: 'me',
      dependencies: [
        edge('me', 'closed-blk', 'blocks'),
        edge('me', 'open-blk', 'blocks'),
      ],
    })
    const map = buildStatusMap([open, closed, blocked])
    expect(hasUnresolvedBlocker(blocked, map)).toBe(true)
  })

  it('does not flag a blocks edge whose blocker is absent from the loaded set (cross-project)', () => {
    const blocked = issue({
      id: 'me',
      dependencies: [edge('me', 'external:foreign-1', 'blocks')],
    })
    const map = buildStatusMap([blocked])
    expect(hasUnresolvedBlocker(blocked, map)).toBe(false)
  })

  it('does not flag an issue whose only edges are non-blocks types', () => {
    const parent = issue({ id: 'epic', status: 'open' })
    const child = issue({
      id: 'me',
      dependencies: [edge('me', 'epic', 'parent-child')],
    })
    const map = buildStatusMap([parent, child])
    expect(hasUnresolvedBlocker(child, map)).toBe(false)
  })

  it('does not flag an issue with no dependency edges', () => {
    const lone = issue({ id: 'me' })
    expect(hasUnresolvedBlocker(lone, buildStatusMap([lone]))).toBe(false)
  })

  it('reports on edges independently of the issue’s own literal blocked status', () => {
    // An issue with the literal `blocked` status but NO unresolved blocks edge → predicate false:
    // the predicate is about edges, not status.
    const noEdges = issue({ id: 'a', status: 'blocked' })
    expect(hasUnresolvedBlocker(noEdges, buildStatusMap([noEdges]))).toBe(false)

    // An issue with the literal `blocked` status AND an open blocks edge → predicate true,
    // derived purely from the edge.
    const blocker = issue({ id: 'blk', status: 'open' })
    const both = issue({
      id: 'b',
      status: 'blocked',
      dependencies: [edge('b', 'blk', 'blocks')],
    })
    expect(hasUnresolvedBlocker(both, buildStatusMap([blocker, both]))).toBe(
      true,
    )
  })
})

describe('buildBlockedIds', () => {
  it('includes an issue whose blocks edge points at an open blocker', () => {
    const blocker = issue({ id: 'blk', status: 'open' })
    const blocked = issue({
      id: 'me',
      dependencies: [edge('me', 'blk', 'blocks')],
    })
    // The blocker itself is not blocked; only the dependent issue is in the set.
    const ids = buildBlockedIds([blocker, blocked])
    expect(ids.has('me')).toBe(true)
    expect(ids.has('blk')).toBe(false)
  })

  it('returns an empty set for empty input', () => {
    expect(buildBlockedIds([])).toEqual(new Set())
  })

  it('omits an issue whose only blocker is already closed', () => {
    const blocker = issue({ id: 'blk', status: 'closed' })
    const blocked = issue({
      id: 'me',
      dependencies: [edge('me', 'blk', 'blocks')],
    })
    expect(buildBlockedIds([blocker, blocked]).has('me')).toBe(false)
  })
})
