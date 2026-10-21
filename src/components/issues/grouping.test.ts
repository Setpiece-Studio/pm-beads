// ABOUTME: Tests for the pure issues-view logic — filtering, ordering, and grouping of issues
// ABOUTME: into Linear-style buckets with the canonical status order.

import { describe, expect, it } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import {
  buildGroups,
  DEFAULT_DISPLAY_PROPERTIES,
  type DisplayProperty,
  filterIssues,
  groupIssues,
  orderIssues,
  parseDisplayProperties,
  serializeDisplayProperties,
  toggleDisplayProperty,
} from './grouping'

let seq = 0
function issue(overrides: Partial<Issue> = {}): Issue {
  seq += 1
  return {
    id: `t-${seq}`,
    title: `Issue ${seq}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

describe('filterIssues', () => {
  it('excludes epics from the row set', () => {
    const issues = [issue(), issue({ issue_type: 'epic' })]
    const out = filterIssues(issues, [], 'status')
    expect(out).toHaveLength(1)
    expect(out[0].issue_type).toBe('task')
  })

  it('includes closed issues when grouping by status', () => {
    const issues = [issue(), issue({ status: 'closed' })]
    expect(filterIssues(issues, [], 'status')).toHaveLength(2)
  })

  it('excludes closed issues when not grouping by status', () => {
    const issues = [issue(), issue({ status: 'closed' })]
    expect(filterIssues(issues, [], 'none')).toHaveLength(1)
    expect(filterIssues(issues, [], 'label')).toHaveLength(1)
  })

  it('shows closed issues outside status grouping when a status filter is active', () => {
    const issues = [issue(), issue({ status: 'closed' })]
    const out = filterIssues(
      issues,
      [{ property: 'status', operator: 'is', values: ['closed'] }],
      'none',
    )
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('closed')
  })

  it('applies active filters ANDed together', () => {
    const target = issue({
      status: 'in_progress',
      issue_type: 'bug',
      labels: ['ui', 'perf'],
      assignee: 'ben',
    })
    const issues = [
      target,
      issue({ status: 'open', issue_type: 'bug', assignee: 'ben' }),
      issue({ status: 'in_progress', issue_type: 'task', labels: ['ui'] }),
      issue({ status: 'in_progress', issue_type: 'bug', assignee: 'kim' }),
    ]
    expect(
      filterIssues(
        issues,
        [{ property: 'status', operator: 'is', values: ['in_progress'] }],
        'status',
      ),
    ).toHaveLength(3)
    expect(
      filterIssues(
        issues,
        [{ property: 'type', operator: 'is-not', values: ['bug'] }],
        'status',
      ),
    ).toHaveLength(1)
    const all = filterIssues(
      issues,
      [
        { property: 'status', operator: 'is', values: ['in_progress'] },
        { property: 'type', operator: 'is', values: ['bug'] },
        { property: 'label', operator: 'is', values: ['ui'] },
        { property: 'assignee', operator: 'is', values: ['ben'] },
      ],
      'status',
    )
    expect(all).toEqual([target])
  })
})

describe('orderIssues', () => {
  it('orders by priority ascending with updated-desc tiebreak', () => {
    const a = issue({ priority: 3, updated_at: '2026-06-10T00:00:00Z' })
    const b = issue({ priority: 0, updated_at: '2026-06-01T00:00:00Z' })
    const c = issue({ priority: 3, updated_at: '2026-06-11T00:00:00Z' })
    expect(orderIssues([a, b, c], 'priority').map((i) => i.id)).toEqual([
      b.id,
      c.id,
      a.id,
    ])
  })

  it('orders by status using the canonical status order, then priority', () => {
    const open = issue({ status: 'open', priority: 0 })
    const blocked = issue({ status: 'blocked', priority: 3 })
    const inProgress = issue({ status: 'in_progress', priority: 4 })
    const closed = issue({ status: 'closed', priority: 0 })
    const out = orderIssues([open, closed, blocked, inProgress], 'status')
    expect(out.map((i) => i.id)).toEqual([
      inProgress.id,
      blocked.id,
      open.id,
      closed.id,
    ])
  })

  it('orders by updated time, most recent first', () => {
    const old = issue({ updated_at: '2026-01-01T00:00:00Z' })
    const fresh = issue({ updated_at: '2026-06-12T00:00:00Z' })
    expect(orderIssues([old, fresh], 'updated').map((i) => i.id)).toEqual([
      fresh.id,
      old.id,
    ])
  })
})

describe('groupIssues', () => {
  it('buckets by status in the canonical order, skipping empty groups', () => {
    const issues = [
      issue({ status: 'closed' }),
      issue({ status: 'open' }),
      issue({ status: 'in_progress' }),
      issue({ status: 'open' }),
    ]
    const groups = groupIssues(issues, 'status', {})
    expect(groups.map((g) => g.key)).toEqual(['in_progress', 'open', 'closed'])
    expect(groups.map((g) => g.label)).toEqual(['In Progress', 'Open', 'Done'])
    expect(groups[1].issues).toHaveLength(2)
  })

  it('keeps custom statuses and follows the configured pipeline order', () => {
    const issues = [
      issue({ status: 'open' }),
      issue({ status: 'qa' }),
      issue({ status: 'in_review' }),
    ]
    const groups = groupIssues(
      issues,
      'status',
      {},
      [],
      ['open', 'in_review', 'qa'],
    )
    expect(groups.map((group) => group.key)).toEqual([
      'open',
      'in_review',
      'qa',
    ])
    expect(groups.flatMap((group) => group.issues)).toHaveLength(3)
  })

  it('buckets by project using epic names, with No project last', () => {
    const issues = [issue({ parent: 'e-2' }), issue(), issue({ parent: 'e-1' })]
    const groups = groupIssues(issues, 'project', {
      'e-1': 'Alpha',
      'e-2': 'Zeta',
    })
    expect(groups.map((g) => g.label)).toEqual(['Alpha', 'Zeta', 'No project'])
  })

  it('buckets by label alphabetically, issues appearing in each of their label groups', () => {
    const both = issue({ labels: ['b-label', 'a-label'] })
    const none = issue()
    const groups = groupIssues([both, none], 'label', {})
    expect(groups.map((g) => g.label)).toEqual([
      'a-label',
      'b-label',
      'No label',
    ])
    expect(groups[0].issues[0].id).toBe(both.id)
    expect(groups[1].issues[0].id).toBe(both.id)
    expect(groups[2].issues[0].id).toBe(none.id)
  })

  it('only emits positively filtered labels when grouping by label', () => {
    const both = issue({ id: 'both', labels: ['frontend', 'backend'] })
    const groups = groupIssues([both], 'label', {}, [
      { property: 'label', operator: 'is', values: ['frontend'] },
    ])

    expect(groups.map((group) => group.key)).toEqual(['frontend'])
    expect(groups[0]?.issues).toEqual([both])
  })

  it('keeps all remaining groups for a negative label filter', () => {
    const backend = issue({ id: 'backend', labels: ['backend', 'infra'] })
    const groups = buildGroups(
      [backend],
      {
        grouping: 'label',
        ordering: 'priority',
        filters: [
          { property: 'label', operator: 'is-not', values: ['frontend'] },
        ],
      },
      {},
    )

    expect(groups.map((group) => group.key)).toEqual(['backend', 'infra'])
  })

  it('returns a single group when grouping is none', () => {
    const groups = groupIssues([issue(), issue()], 'none', {})
    expect(groups).toHaveLength(1)
    expect(groups[0].issues).toHaveLength(2)
  })
})

describe('buildGroups', () => {
  it('filters, orders within groups, and buckets in one pass', () => {
    const issues = [
      issue({ status: 'open', priority: 3 }),
      issue({ status: 'open', priority: 0 }),
      issue({ status: 'in_progress', priority: 2 }),
      issue({ status: 'closed', priority: 1 }),
      issue({ issue_type: 'epic' }),
    ]
    const groups = buildGroups(
      issues,
      { grouping: 'status', ordering: 'priority', filters: [] },
      {},
    )
    expect(groups.map((g) => g.key)).toEqual(['in_progress', 'open', 'closed'])
    const open = groups[1]
    expect(open.issues.map((i) => i.priority)).toEqual([0, 3])
  })
})

describe('display properties', () => {
  it('parses an undefined param as the defaults', () => {
    expect(parseDisplayProperties(undefined)).toEqual(
      DEFAULT_DISPLAY_PROPERTIES,
    )
  })

  it('parses a comma-separated list, dropping unknown names', () => {
    const parsed = parseDisplayProperties('id,status,bogus,labels')
    expect([...parsed].sort()).toEqual(['id', 'labels', 'status'])
  })

  it('parses an empty string as no properties (all hidden)', () => {
    expect(parseDisplayProperties('').size).toBe(0)
  })

  it('serializes the default set as undefined to keep URLs clean', () => {
    expect(
      serializeDisplayProperties(new Set(DEFAULT_DISPLAY_PROPERTIES)),
    ).toBeUndefined()
  })

  it('serializes a custom set in canonical order', () => {
    const set = new Set<DisplayProperty>(['updated', 'id', 'priority'])
    expect(serializeDisplayProperties(set)).toBe('priority,id,updated')
  })

  it('round-trips through parse and serialize', () => {
    const set = new Set<DisplayProperty>(['status', 'labels', 'created'])
    const serialized = serializeDisplayProperties(set)
    expect(serialized).toBeDefined()
    expect(parseDisplayProperties(serialized)).toEqual(set)
  })

  it('toggles a property on and off without mutating the input', () => {
    const original = new Set<DisplayProperty>(['id'])
    const without = toggleDisplayProperty(original, 'id')
    expect(without.has('id')).toBe(false)
    expect(original.has('id')).toBe(true)
    const withStatus = toggleDisplayProperty(original, 'status')
    expect(withStatus.has('status')).toBe(true)
    expect(withStatus.has('id')).toBe(true)
  })
})
