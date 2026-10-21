// ABOUTME: Tests for the pure board-view logic — view-mode URL serialization, drag
// ABOUTME: enablement per grouping, drop-to-status resolution, and card field visibility.

import { describe, expect, it } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import {
  boardCardProperties,
  dragEnabled,
  orderBoardGroups,
  serializeViewMode,
  statusAfterDrop,
} from './board-logic'
import { DEFAULT_DISPLAY_PROPERTIES, type DisplayProperty } from './grouping'

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

describe('serializeViewMode', () => {
  it('omits the default list view from the URL', () => {
    expect(serializeViewMode('list')).toBeUndefined()
  })

  it('writes board explicitly', () => {
    expect(serializeViewMode('board')).toBe('board')
  })
})

describe('dragEnabled', () => {
  it('enables drag only when grouping by status', () => {
    expect(dragEnabled('status')).toBe(true)
    expect(dragEnabled('project')).toBe(false)
    expect(dragEnabled('label')).toBe(false)
    expect(dragEnabled('none')).toBe(false)
  })
})

describe('statusAfterDrop', () => {
  it('returns the target column status for a cross-column drop', () => {
    expect(statusAfterDrop(issue({ status: 'open' }), 'in_progress')).toBe(
      'in_progress',
    )
  })

  it('returns null when dropped back on its own column', () => {
    expect(statusAfterDrop(issue({ status: 'open' }), 'open')).toBeNull()
  })
})

describe('boardCardProperties', () => {
  it('follows the display-property toggles for priority, labels, and project', () => {
    expect(boardCardProperties(DEFAULT_DISPLAY_PROPERTIES)).toEqual({
      priority: true,
      labels: true,
      project: true,
    })
  })

  it('hides toggled-off fields', () => {
    const none: ReadonlySet<DisplayProperty> = new Set(['id', 'status'])
    expect(boardCardProperties(none)).toEqual({
      priority: false,
      labels: false,
      project: false,
    })
  })
})

describe('orderBoardGroups', () => {
  const group = (key: string) => ({ key, label: key, status: key, issues: [] })

  it('orders status columns as a left-to-right pipeline', () => {
    const groups = ['in_progress', 'closed', 'open', 'deferred', 'blocked'].map(
      group,
    )
    expect(orderBoardGroups(groups, 'status').map((g) => g.key)).toEqual([
      'deferred',
      'open',
      'in_progress',
      'blocked',
      'closed',
    ])
  })

  it('keeps unknown statuses at the end in their incoming order', () => {
    const groups = ['weird', 'open', 'custom'].map(group)
    expect(orderBoardGroups(groups, 'status').map((g) => g.key)).toEqual([
      'open',
      'weird',
      'custom',
    ])
  })

  it('uses a project-configured pipeline when provided', () => {
    const groups = ['closed', 'qa', 'open', 'in_review'].map(group)
    expect(
      orderBoardGroups(groups, 'status', [
        'open',
        'in_review',
        'qa',
        'closed',
      ]).map((g) => g.key),
    ).toEqual(['open', 'in_review', 'qa', 'closed'])
  })

  it('leaves non-status groupings untouched', () => {
    const groups = ['b', 'a'].map(group)
    expect(orderBoardGroups(groups, 'project').map((g) => g.key)).toEqual([
      'b',
      'a',
    ])
  })
})
