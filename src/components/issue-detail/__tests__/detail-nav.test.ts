// ABOUTME: Tests for the detail top bar's ordering helpers — the issues/projects reading orders
// ABOUTME: derived from the list views' own models, neighbour lookup, and the breadcrumb name.

import { describe, expect, it } from 'vitest'
import { buildStatusPipeline } from '@/lib/beads/status-model'
import type { EpicStatus, Issue } from '@/lib/beads/types'
import {
  type IssueListContext,
  orderedEpicIds,
  orderedIssueIds,
  projectDisplayName,
  siblingNav,
} from '../detail-nav'

function issue(id: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id,
    title: `Issue ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

function epic(id: string, overrides: Partial<Issue> = {}): EpicStatus {
  return {
    epic: issue(id, { issue_type: 'epic', ...overrides }),
    total_children: 0,
    closed_children: 0,
    eligible_for_close: false,
  }
}

const listContext: IssueListContext = {
  grouping: 'status',
  ordering: 'priority',
  filters: [],
  view: 'list',
}

describe('orderedIssueIds', () => {
  it('concatenates the rendered groups top to bottom', () => {
    const issues = [
      issue('a', { status: 'open', priority: 3 }),
      issue('b', { status: 'in_progress', priority: 1 }),
      issue('c', { status: 'open', priority: 0 }),
    ]
    // Status grouping renders In Progress before Open (STATUS_ORDER), and priority
    // orders within each group.
    expect(orderedIssueIds(issues, listContext, {})).toEqual(['b', 'c', 'a'])
  })

  it('omits epics and the closed issues the list itself hides', () => {
    const issues = [
      issue('a'),
      issue('e', { issue_type: 'epic' }),
      issue('done', { status: 'closed' }),
    ]
    const ids = orderedIssueIds(
      issues,
      { ...listContext, grouping: 'none' },
      {},
    )
    expect(ids).toEqual(['a'])
  })

  it('honours active filters, so a hidden row is absent from the order', () => {
    const issues = [issue('a', { priority: 0 }), issue('b', { priority: 3 })]
    const ids = orderedIssueIds(
      issues,
      {
        ...listContext,
        filters: [{ property: 'priority', operator: 'is', values: ['0'] }],
      },
      {},
    )
    expect(ids).toEqual(['a'])
  })

  it('counts an issue once when label grouping repeats it across groups', () => {
    const issues = [
      issue('a', { labels: ['ui', 'api'] }),
      issue('b', { labels: ['ui'] }),
    ]
    const ids = orderedIssueIds(
      issues,
      { ...listContext, grouping: 'label' },
      {},
    )
    expect(ids).toEqual(['a', 'b'])
  })

  it('follows the board column order in board view', () => {
    const issues = [
      issue('open-one', { status: 'open' }),
      issue('deferred-one', { status: 'deferred' }),
    ]
    // The list reads triage-first (open before deferred); the board reads as a
    // left→right pipeline, which puts deferred first.
    expect(orderedIssueIds(issues, listContext, {})).toEqual([
      'open-one',
      'deferred-one',
    ])
    expect(
      orderedIssueIds(issues, { ...listContext, view: 'board' }, {}),
    ).toEqual(['deferred-one', 'open-one'])
  })

  // The top bar's "3 / 12" and its Previous/Next walk the list the row was opened from, so
  // they have to read it in the order that list actually rendered. Deriving the order from the
  // built-in defaults made the detail disagree with the view behind it in any project that
  // authored a pipeline (pm-beads-r8l.3).
  it('reads a project’s authored pipeline, not the built-in list order', () => {
    const issues = [
      issue('shipping', { status: 'awaiting_deploy' }),
      issue('working', { status: 'in_progress' }),
    ]
    const pipeline = buildStatusPipeline({
      block: {
        pipeline: ['open', 'in_progress', 'awaiting_deploy', 'closed'],
      },
    })
    expect(orderedIssueIds(issues, listContext, {})).toEqual([
      'working',
      'shipping',
    ])
    expect(orderedIssueIds(issues, listContext, {}, pipeline)).toEqual([
      'working',
      'shipping',
    ])
    expect(
      orderedIssueIds(
        issues,
        { ...listContext, grouping: 'status', ordering: 'status' },
        {},
        buildStatusPipeline({
          block: {
            pipeline: ['open', 'awaiting_deploy', 'in_progress', 'closed'],
          },
        }),
      ),
    ).toEqual(['shipping', 'working'])
  })

  it('orders board columns by the project pipeline', () => {
    const issues = [
      issue('working', { status: 'in_progress' }),
      issue('shipping', { status: 'awaiting_deploy' }),
    ]
    const boardContext: IssueListContext = { ...listContext, view: 'board' }
    expect(orderedIssueIds(issues, boardContext, {})).toEqual([
      'working',
      'shipping',
    ])
    expect(
      orderedIssueIds(
        issues,
        boardContext,
        {},
        buildStatusPipeline({
          block: {
            pipeline: ['open', 'awaiting_deploy', 'in_progress', 'closed'],
          },
        }),
      ),
    ).toEqual(['shipping', 'working'])
  })
})

describe('orderedEpicIds', () => {
  it('concatenates the projects view groups and hides closed epics by default', () => {
    const epics = [
      epic('e1', { status: 'open', priority: 2 }),
      epic('e2', { status: 'in_progress', priority: 3 }),
      epic('e3', { status: 'closed' }),
    ]
    const ids = orderedEpicIds(epics, {
      grouping: 'status',
      ordering: 'priority',
      filters: [],
    })
    expect(ids).toEqual(['e2', 'e1'])
  })

  it('reads a project’s authored pipeline, not the built-in list order', () => {
    const epics = [
      epic('e1', { status: 'open' }),
      epic('e2', { status: 'in_progress' }),
    ]
    const context = {
      grouping: 'status' as const,
      ordering: 'priority' as const,
      filters: [],
    }
    expect(orderedEpicIds(epics, context)).toEqual(['e2', 'e1'])
    expect(
      orderedEpicIds(
        epics,
        context,
        {},
        buildStatusPipeline({
          block: { pipeline: ['open', 'in_progress', 'closed'] },
        }),
      ),
    ).toEqual(['e1', 'e2'])
  })
})

describe('siblingNav', () => {
  const ids = ['a', 'b', 'c']

  it('reports a 1-based position with both neighbours in the middle', () => {
    expect(siblingNav(ids, 'b')).toEqual({
      index: 2,
      total: 3,
      previousId: 'a',
      nextId: 'c',
    })
  })

  it('has no previous at the first row and no next at the last', () => {
    expect(siblingNav(ids, 'a')).toMatchObject({
      index: 1,
      previousId: undefined,
      nextId: 'b',
    })
    expect(siblingNav(ids, 'c')).toMatchObject({
      index: 3,
      previousId: 'b',
      nextId: undefined,
    })
  })

  it('returns null when the item is not in the list', () => {
    expect(siblingNav(ids, 'zz')).toBeNull()
    expect(siblingNav([], 'a')).toBeNull()
  })
})

describe('projectDisplayName', () => {
  it('falls back to the env-default project name when none is selected', () => {
    expect(projectDisplayName(undefined, 'pm-beads')).toBe('pm-beads')
  })

  it('uses the selected project directory’s name, trailing slash or not', () => {
    expect(projectDisplayName('/Users/x/dev/example-project', 'pm-beads')).toBe(
      'example-project',
    )
    expect(
      projectDisplayName('/Users/x/dev/example-project/', 'pm-beads'),
    ).toBe('example-project')
  })
})
