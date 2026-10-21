// ABOUTME: Unit tests for dependency-meta — (type, direction) group labels, the bd mutation
// ABOUTME: verb/argument-order mapping, and grouping with relates-to dedup across both arrays.

import { describe, expect, it } from 'vitest'
import {
  dependencyGroupLabel,
  dependencyMutation,
  groupDependencies,
} from '../dependency-meta'
import type { LinkedIssue } from '../types'

// Minimal LinkedIssue factory — only id and dependency_type drive the helpers under test.
function linked(id: string, type: string): LinkedIssue {
  return {
    id,
    title: `Issue ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-15T00:00:00Z',
    updated_at: '2026-06-15T00:00:00Z',
    dependency_type: type,
  }
}

describe('dependencyGroupLabel', () => {
  it('maps blocks/down to "Blocked by" and blocks/up to "Blocking"', () => {
    expect(dependencyGroupLabel('blocks', 'down')).toBe('Blocked by')
    expect(dependencyGroupLabel('blocks', 'up')).toBe('Blocking')
  })

  it('maps parent-child/down to "Parent" and parent-child/up to "Sub-issues"', () => {
    expect(dependencyGroupLabel('parent-child', 'down')).toBe('Parent')
    expect(dependencyGroupLabel('parent-child', 'up')).toBe('Sub-issues')
  })

  it('maps relates-to to "Related" in both directions', () => {
    expect(dependencyGroupLabel('relates-to', 'down')).toBe('Related')
    expect(dependencyGroupLabel('relates-to', 'up')).toBe('Related')
  })

  it('maps the less-common directed types', () => {
    expect(dependencyGroupLabel('discovered-from', 'down')).toBe(
      'Discovered from',
    )
    expect(dependencyGroupLabel('discovered-from', 'up')).toBe(
      'Discovered here',
    )
    expect(dependencyGroupLabel('supersedes', 'down')).toBe('Supersedes')
    expect(dependencyGroupLabel('supersedes', 'up')).toBe('Superseded by')
  })

  it('returns a humanized fallback for unknown types in both directions (no doubled "by")', () => {
    // The fallback is direction-agnostic: a plain humanized label both ways, never a doubled
    // suffix like "Caused by by".
    expect(dependencyGroupLabel('caused-by', 'down')).toBe('Caused by')
    expect(dependencyGroupLabel('caused-by', 'up')).toBe('Caused by')
    expect(dependencyGroupLabel('caused-by', 'up')).not.toContain('by by')
    expect(dependencyGroupLabel('tracks', 'down')).toBe('Tracks')
    expect(dependencyGroupLabel('tracks', 'up')).toBe('Tracks')
    // never blank
    expect(dependencyGroupLabel('caused-by', 'down').length).toBeGreaterThan(0)
  })
})

describe('dependencyMutation', () => {
  it('blocks/down adds (this depends on other)', () => {
    const m = dependencyMutation('blocks', 'down', 'this', 'other')
    expect(m).toEqual({
      verb: 'dep',
      type: 'blocks',
      issueId: 'this',
      dependsOnId: 'other',
    })
  })

  it('blocks/up reverses the argument order (other depends on this)', () => {
    const m = dependencyMutation('blocks', 'up', 'this', 'other')
    expect(m).toEqual({
      verb: 'dep',
      type: 'blocks',
      issueId: 'other',
      dependsOnId: 'this',
    })
  })

  it('remove mirrors add: same (issueId, dependsOnId) pair for a given (type, direction)', () => {
    // The single mapping is used for both add and remove, so the order is identical by
    // construction — this pins that the editor reuses one source for both ops.
    const down = dependencyMutation('blocks', 'down', 'this', 'other')
    expect([down.issueId, down.dependsOnId]).toEqual(['this', 'other'])
    const up = dependencyMutation('blocks', 'up', 'this', 'other')
    expect([up.issueId, up.dependsOnId]).toEqual(['other', 'this'])
  })

  it('relates-to maps to the symmetric relate verb', () => {
    const down = dependencyMutation('relates-to', 'down', 'this', 'other')
    const up = dependencyMutation('relates-to', 'up', 'this', 'other')
    expect(down.verb).toBe('relate')
    expect(up.verb).toBe('relate')
    expect(down.issueId).toBe('this')
    expect(down.dependsOnId).toBe('other')
  })

  it('keeps directed verb for unknown types and encodes direction', () => {
    const down = dependencyMutation('caused-by', 'down', 'this', 'other')
    expect(down).toEqual({
      verb: 'dep',
      type: 'caused-by',
      issueId: 'this',
      dependsOnId: 'other',
    })
  })
})

describe('groupDependencies', () => {
  it('returns only non-empty groups in the defined display order', () => {
    const groups = groupDependencies({
      dependencies: [
        linked('a', 'blocks'), // Blocked by
        linked('b', 'parent-child'), // Parent
        linked('c', 'supersedes'), // Supersedes
      ],
      dependents: [
        linked('d', 'blocks'), // Blocking
        linked('e', 'parent-child'), // Sub-issues
      ],
    })
    expect(groups.map((g) => g.label)).toEqual([
      'Blocked by',
      'Blocking',
      'Parent',
      'Sub-issues',
      'Supersedes',
    ])
    // every returned group has members; no empties
    expect(groups.every((g) => g.members.length > 0)).toBe(true)
  })

  it('collapses a relates-to neighbor present in BOTH arrays into one entry', () => {
    const groups = groupDependencies({
      dependencies: [linked('x', 'relates-to')],
      dependents: [linked('x', 'relates-to')],
    })
    const related = groups.filter((g) => g.label === 'Related')
    expect(related).toHaveLength(1)
    expect(related[0].members).toHaveLength(1)
    expect(related[0].members[0].issue.id).toBe('x')
  })

  it('keeps distinct relates-to neighbors as separate members of one Related group', () => {
    const groups = groupDependencies({
      dependencies: [linked('x', 'relates-to')],
      dependents: [linked('y', 'relates-to')],
    })
    const related = groups.filter((g) => g.label === 'Related')
    expect(related).toHaveLength(1)
    expect(related[0].members.map((m) => m.issue.id).sort()).toEqual(['x', 'y'])
  })

  it('accepts a ShowIssue and tolerates null/absent arrays', () => {
    expect(groupDependencies({ dependencies: null, dependents: null })).toEqual(
      [],
    )
    expect(groupDependencies({})).toEqual([])
  })

  it('orders unknown fallback types after the known groups', () => {
    const groups = groupDependencies({
      dependencies: [linked('a', 'caused-by'), linked('b', 'blocks')],
    })
    expect(groups.map((g) => g.label)).toEqual(['Blocked by', 'Caused by'])
  })
})
