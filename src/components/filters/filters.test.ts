// ABOUTME: Tests for the pure filter logic — match semantics per property, URL param
// ABOUTME: serialization round-trips, value-option derivation, and filter-state helpers.

import { describe, expect, it } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import {
  type ActiveFilter,
  EPIC_FILTER_PROPERTIES,
  FILTER_PROPERTIES,
  filterValueOptions,
  ISSUE_FILTER_PROPERTIES,
  issueMatchesFilters,
  NONE_VALUE,
  operatorLabel,
  parseFilters,
  removeFilter,
  serializeFilters,
  setFilterOperator,
  toggleFilterValue,
  valueSummary,
} from './filters'

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

function filter(
  property: ActiveFilter['property'],
  operator: ActiveFilter['operator'],
  values: string[],
): ActiveFilter {
  return { property, operator, values }
}

describe('filter property sets', () => {
  it('issues filter on every property', () => {
    expect(ISSUE_FILTER_PROPERTIES).toEqual([
      'status',
      'type',
      'priority',
      'assignee',
      'label',
      'project',
    ])
  })

  it('epics filter on status, priority, label, and assignee only', () => {
    expect(EPIC_FILTER_PROPERTIES).toEqual([
      'status',
      'priority',
      'label',
      'assignee',
    ])
  })

  it('both sets draw from the full property universe', () => {
    for (const p of [...ISSUE_FILTER_PROPERTIES, ...EPIC_FILTER_PROPERTIES]) {
      expect(FILTER_PROPERTIES).toContain(p)
    }
  })
})

describe('issueMatchesFilters', () => {
  it('matches everything when no filters are active', () => {
    expect(issueMatchesFilters(issue(), [])).toBe(true)
  })

  it('matches status with is when the value is in the set', () => {
    const f = [filter('status', 'is', ['open', 'blocked'])]
    expect(issueMatchesFilters(issue({ status: 'open' }), f)).toBe(true)
    expect(issueMatchesFilters(issue({ status: 'closed' }), f)).toBe(false)
  })

  it('matches status with is-not when the value is outside the set', () => {
    const f = [filter('status', 'is-not', ['closed'])]
    expect(issueMatchesFilters(issue({ status: 'open' }), f)).toBe(true)
    expect(issueMatchesFilters(issue({ status: 'closed' }), f)).toBe(false)
  })

  it('matches type and priority (priority values are strings)', () => {
    expect(
      issueMatchesFilters(issue({ issue_type: 'bug' }), [
        filter('type', 'is', ['bug', 'chore']),
      ]),
    ).toBe(true)
    expect(
      issueMatchesFilters(issue({ priority: 1 }), [
        filter('priority', 'is', ['1']),
      ]),
    ).toBe(true)
    expect(
      issueMatchesFilters(issue({ priority: 2 }), [
        filter('priority', 'is', ['1']),
      ]),
    ).toBe(false)
  })

  it('matches assignee including the no-assignee pseudo-value', () => {
    const noAssignee = [filter('assignee', 'is', [NONE_VALUE])]
    expect(issueMatchesFilters(issue(), noAssignee)).toBe(true)
    expect(issueMatchesFilters(issue({ assignee: 'ben' }), noAssignee)).toBe(
      false,
    )
    expect(
      issueMatchesFilters(issue({ assignee: 'ben' }), [
        filter('assignee', 'is-not', [NONE_VALUE]),
      ]),
    ).toBe(true)
  })

  it('matches project (parent epic) including the no-project pseudo-value', () => {
    expect(
      issueMatchesFilters(issue({ parent: 'e-1' }), [
        filter('project', 'is', ['e-1']),
      ]),
    ).toBe(true)
    expect(
      issueMatchesFilters(issue(), [filter('project', 'is', [NONE_VALUE])]),
    ).toBe(true)
    expect(
      issueMatchesFilters(issue({ parent: 'e-1' }), [
        filter('project', 'is', [NONE_VALUE]),
      ]),
    ).toBe(false)
  })

  it('label is matches when ANY of the issue labels is in the set', () => {
    const f = [filter('label', 'is', ['ui'])]
    expect(issueMatchesFilters(issue({ labels: ['ui', 'perf'] }), f)).toBe(true)
    expect(issueMatchesFilters(issue({ labels: ['perf'] }), f)).toBe(false)
    expect(issueMatchesFilters(issue({ labels: undefined }), f)).toBe(false)
  })

  it('label is-not matches when NONE of the issue labels is in the set', () => {
    const f = [filter('label', 'is-not', ['ui'])]
    expect(issueMatchesFilters(issue({ labels: ['perf'] }), f)).toBe(true)
    expect(issueMatchesFilters(issue({ labels: ['ui', 'perf'] }), f)).toBe(
      false,
    )
    expect(issueMatchesFilters(issue(), f)).toBe(true)
  })

  it('treats unlabeled issues as the no-label pseudo-value', () => {
    expect(
      issueMatchesFilters(issue(), [filter('label', 'is', [NONE_VALUE])]),
    ).toBe(true)
    expect(
      issueMatchesFilters(issue({ labels: ['ui'] }), [
        filter('label', 'is', [NONE_VALUE]),
      ]),
    ).toBe(false)
    expect(
      issueMatchesFilters(issue(), [filter('label', 'is-not', [NONE_VALUE])]),
    ).toBe(false)
  })

  it('ANDs multiple filters together', () => {
    const f = [
      filter('status', 'is', ['open']),
      filter('type', 'is-not', ['bug']),
    ]
    expect(issueMatchesFilters(issue({ status: 'open' }), f)).toBe(true)
    expect(
      issueMatchesFilters(issue({ status: 'open', issue_type: 'bug' }), f),
    ).toBe(false)
    expect(issueMatchesFilters(issue({ status: 'closed' }), f)).toBe(false)
  })

  it('treats a filter with no values as matching everything', () => {
    expect(issueMatchesFilters(issue(), [filter('status', 'is', [])])).toBe(
      true,
    )
    expect(issueMatchesFilters(issue(), [filter('status', 'is-not', [])])).toBe(
      true,
    )
  })
})

describe('serializeFilters / parseFilters', () => {
  it('serializes one filter as property:operator:values', () => {
    expect(serializeFilters([filter('status', 'is', ['open'])])).toBe(
      'status:is:open',
    )
  })

  it('serializes multiple values comma-separated and filters semicolon-separated', () => {
    expect(
      serializeFilters([
        filter('status', 'is', ['open', 'in_progress']),
        filter('label', 'is-not', ['bug']),
      ]),
    ).toBe('status:is:open,in_progress;label:is-not:bug')
  })

  it('serializes an empty filter list as undefined to keep URLs clean', () => {
    expect(serializeFilters([])).toBeUndefined()
  })

  it('percent-encodes values containing delimiter characters', () => {
    const serialized = serializeFilters([filter('label', 'is', ['a:b,c;d'])])
    expect(serialized).toBe('label:is:a%3Ab%2Cc%3Bd')
    expect(parseFilters(serialized)).toEqual([
      filter('label', 'is', ['a:b,c;d']),
    ])
  })

  it('parses undefined and empty strings as no filters', () => {
    expect(parseFilters(undefined)).toEqual([])
    expect(parseFilters('')).toEqual([])
  })

  it('round-trips every property and both operators', () => {
    const filters: ActiveFilter[] = FILTER_PROPERTIES.map((p, i) =>
      filter(p, i % 2 === 0 ? 'is' : 'is-not', ['v1', 'v2']),
    )
    expect(parseFilters(serializeFilters(filters))).toEqual(filters)
  })

  it('drops malformed clauses, unknown properties, and unknown operators', () => {
    expect(parseFilters('bogus:is:x;status:was:open;status;;')).toEqual([])
    expect(parseFilters('status:is:open;nope:is:x')).toEqual([
      filter('status', 'is', ['open']),
    ])
  })

  it('drops clauses with no values and dedupes repeated values', () => {
    expect(parseFilters('status:is:')).toEqual([])
    expect(parseFilters('status:is:open,open,closed')).toEqual([
      filter('status', 'is', ['open', 'closed']),
    ])
  })

  it('keeps only the first clause for a repeated property', () => {
    expect(parseFilters('status:is:open;status:is-not:closed')).toEqual([
      filter('status', 'is', ['open']),
    ])
  })
})

describe('filter state helpers', () => {
  it('toggleFilterValue creates a new is-filter when the property is absent', () => {
    expect(toggleFilterValue([], 'status', 'open')).toEqual([
      filter('status', 'is', ['open']),
    ])
  })

  it('toggleFilterValue appends a value to an existing filter', () => {
    const start = [filter('status', 'is', ['open'])]
    expect(toggleFilterValue(start, 'status', 'blocked')).toEqual([
      filter('status', 'is', ['open', 'blocked']),
    ])
  })

  it('toggleFilterValue removes a checked value, preserving the operator', () => {
    const start = [filter('status', 'is-not', ['open', 'blocked'])]
    expect(toggleFilterValue(start, 'status', 'open')).toEqual([
      filter('status', 'is-not', ['blocked']),
    ])
  })

  it('toggleFilterValue removes the whole filter when the last value is unchecked', () => {
    const start = [
      filter('status', 'is', ['open']),
      filter('label', 'is', ['ui']),
    ]
    expect(toggleFilterValue(start, 'status', 'open')).toEqual([
      filter('label', 'is', ['ui']),
    ])
  })

  it('toggleFilterValue does not mutate its input', () => {
    const start = [filter('status', 'is', ['open'])]
    toggleFilterValue(start, 'status', 'blocked')
    expect(start).toEqual([filter('status', 'is', ['open'])])
  })

  it('setFilterOperator flips the operator for one property only', () => {
    const start = [
      filter('status', 'is', ['open']),
      filter('label', 'is', ['ui']),
    ]
    expect(setFilterOperator(start, 'status', 'is-not')).toEqual([
      filter('status', 'is-not', ['open']),
      filter('label', 'is', ['ui']),
    ])
  })

  it('removeFilter drops the filter for a property', () => {
    const start = [
      filter('status', 'is', ['open']),
      filter('label', 'is', ['ui']),
    ]
    expect(removeFilter(start, 'status')).toEqual([
      filter('label', 'is', ['ui']),
    ])
  })
})

describe('operatorLabel', () => {
  it('uses is / is not for a single value', () => {
    expect(operatorLabel('is', 1)).toBe('is')
    expect(operatorLabel('is-not', 1)).toBe('is not')
  })

  it('uses any-of phrasing for multiple values', () => {
    expect(operatorLabel('is', 2)).toBe('is any of')
    expect(operatorLabel('is-not', 3)).toBe('is not any of')
  })
})

describe('valueSummary', () => {
  const statusOptions = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
  ]

  it('shows the display label for a single value', () => {
    expect(valueSummary(filter('status', 'is', ['open']), statusOptions)).toBe(
      'Open',
    )
  })

  it('falls back to the raw value when no option matches', () => {
    expect(
      valueSummary(filter('status', 'is', ['custom']), statusOptions),
    ).toBe('custom')
  })

  it('shows a count with the property noun for multiple values', () => {
    expect(
      valueSummary(
        filter('status', 'is', ['open', 'in_progress']),
        statusOptions,
      ),
    ).toBe('2 statuses')
    expect(valueSummary(filter('label', 'is', ['a', 'b', 'c']), [])).toBe(
      '3 labels',
    )
    expect(valueSummary(filter('priority', 'is', ['0', '1']), [])).toBe(
      '2 priorities',
    )
  })
})

describe('filterValueOptions', () => {
  const issues = [
    issue({ status: 'open', labels: ['ui'], assignee: 'ben' }),
    issue({ status: 'custom_status', labels: ['perf', 'ui'], assignee: 'kim' }),
    issue({ parent: 'e-1' }),
  ]
  const epics = [
    { id: 'e-2', title: 'Zeta' },
    { id: 'e-1', title: 'Alpha' },
  ]

  it('statuses: canonical order first, then extras found in data', () => {
    const options = filterValueOptions('status', issues, epics)
    expect(options.map((o) => o.value)).toEqual([
      'in_progress',
      'blocked',
      'open',
      'deferred',
      'closed',
      'custom_status',
    ])
    expect(options[0].label).toBe('In Progress')
  })

  it('types: the fixed non-epic list', () => {
    expect(
      filterValueOptions('type', issues, epics).map((o) => o.value),
    ).toEqual(['task', 'bug', 'feature', 'chore'])
  })

  it('priorities: 0-4 with Linear labels', () => {
    const options = filterValueOptions('priority', issues, epics)
    expect(options.map((o) => o.value)).toEqual(['0', '1', '2', '3', '4'])
    expect(options.map((o) => o.label)).toEqual([
      'Urgent',
      'High',
      'Medium',
      'Low',
      'Backlog',
    ])
  })

  it('labels: sorted from data plus a trailing No label pseudo-value', () => {
    const options = filterValueOptions('label', issues, epics)
    expect(options.map((o) => o.value)).toEqual(['perf', 'ui', NONE_VALUE])
    expect(options.at(-1)?.label).toBe('No label')
  })

  it('assignees: sorted from data plus a trailing No assignee pseudo-value', () => {
    const options = filterValueOptions('assignee', issues, epics)
    expect(options.map((o) => o.value)).toEqual(['ben', 'kim', NONE_VALUE])
    expect(options.at(-1)?.label).toBe('No assignee')
  })

  it('projects: epics by title plus a trailing No project pseudo-value', () => {
    const options = filterValueOptions('project', issues, epics)
    expect(options.map((o) => o.value)).toEqual(['e-1', 'e-2', NONE_VALUE])
    expect(options.map((o) => o.label)).toEqual(['Alpha', 'Zeta', 'No project'])
  })
})
