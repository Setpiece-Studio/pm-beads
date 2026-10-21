// ABOUTME: Unit tests for the sub-issues pure logic — row ordering, completion counts, the
// ABOUTME: show-completed filter, and merging locally created children with the loader's list.

import { describe, expect, it } from 'vitest'
import {
  filterSubIssues,
  mergeSubIssues,
  orderSubIssues,
  type SubIssue,
  subIssueProgress,
} from '../sub-issues-model'

function child(overrides: Partial<SubIssue> & { id: string }): SubIssue {
  return {
    title: `Child ${overrides.id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  }
}

describe('subIssueProgress', () => {
  it('counts closed children against the total', () => {
    expect(
      subIssueProgress([
        child({ id: 'a', status: 'closed' }),
        child({ id: 'b' }),
        child({ id: 'c', status: 'in_progress' }),
      ]),
    ).toEqual({ closed: 1, total: 3 })
  })

  it('reports 0/0 for no children', () => {
    expect(subIssueProgress([])).toEqual({ closed: 0, total: 0 })
  })
})

describe('orderSubIssues', () => {
  it('puts open work before closed work regardless of priority', () => {
    const ordered = orderSubIssues([
      child({ id: 'a', status: 'closed', priority: 0 }),
      child({ id: 'b', status: 'open', priority: 4 }),
    ])
    expect(ordered.map((issue) => issue.id)).toEqual(['b', 'a'])
  })

  it('orders by priority within the open and closed halves', () => {
    const ordered = orderSubIssues([
      child({ id: 'a', priority: 3 }),
      child({ id: 'b', priority: 0 }),
      child({ id: 'c', status: 'closed', priority: 3 }),
      child({ id: 'd', status: 'closed', priority: 1 }),
    ])
    expect(ordered.map((issue) => issue.id)).toEqual(['b', 'a', 'd', 'c'])
  })

  it('breaks priority ties on id so the order is deterministic', () => {
    const ordered = orderSubIssues([
      child({ id: 'pm-3' }),
      child({ id: 'pm-1' }),
      child({ id: 'pm-2' }),
    ])
    expect(ordered.map((issue) => issue.id)).toEqual(['pm-1', 'pm-2', 'pm-3'])
  })

  it('does not mutate the input', () => {
    const input = [child({ id: 'b', priority: 3 }), child({ id: 'a' })]
    orderSubIssues(input)
    expect(input.map((issue) => issue.id)).toEqual(['b', 'a'])
  })

  it('treats any non-closed status as open work', () => {
    const ordered = orderSubIssues([
      child({ id: 'a', status: 'closed', priority: 0 }),
      child({ id: 'b', status: 'blocked', priority: 3 }),
      child({ id: 'c', status: 'deferred', priority: 4 }),
    ])
    expect(ordered.map((issue) => issue.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('filterSubIssues', () => {
  const issues = [child({ id: 'a', status: 'closed' }), child({ id: 'b' })]

  it('keeps everything when completed rows are shown', () => {
    expect(filterSubIssues(issues, true).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('drops closed rows when completed rows are hidden', () => {
    expect(filterSubIssues(issues, false).map((i) => i.id)).toEqual(['b'])
  })
})

describe('mergeSubIssues', () => {
  it('appends locally created children to the loader list', () => {
    const merged = mergeSubIssues([child({ id: 'a' })], [child({ id: 'b' })])
    expect(merged.map((issue) => issue.id).sort()).toEqual(['a', 'b'])
  })

  it('dedupes once the loader catches up, preferring the loader copy', () => {
    const merged = mergeSubIssues(
      [child({ id: 'a', status: 'closed' })],
      [child({ id: 'a', status: 'open' })],
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].status).toBe('closed')
  })
})
