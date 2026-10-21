// ABOUTME: Unit coverage for per-project Issues and Projects route-state preferences.

import { describe, expect, it } from 'vitest'
import {
  hasExplicitIssueViewParams,
  hasExplicitProjectViewParams,
  issueViewPreferenceKey,
  normalizeIssueViewPreference,
  normalizeProjectViewPreference,
  projectViewPreferenceKey,
} from './view-preferences'

describe('view preferences', () => {
  it('stores the normalized issues state without project identity', () => {
    expect(
      normalizeIssueViewPreference({
        project: '/work/example-project',
        view: 'board',
        grouping: 'label',
        display: 'labels,id',
        filter: 'status:is:open',
      }),
    ).toEqual({
      view: 'board',
      grouping: 'label',
      display: 'id,labels',
      filter: 'status:is:open',
    })
  })

  it('keeps preferences distinct by project', () => {
    expect(issueViewPreferenceKey('/work/example-project')).not.toBe(
      issueViewPreferenceKey('/work/sample-project'),
    )
    expect(projectViewPreferenceKey('/work/example-project')).not.toBe(
      projectViewPreferenceKey('/work/sample-project'),
    )
  })

  it('does not mistake route defaults for an explicit view shape', () => {
    expect(
      hasExplicitIssueViewParams({ grouping: 'status', ordering: 'priority' }),
    ).toBe(false)
    expect(hasExplicitIssueViewParams({ grouping: 'project' })).toBe(true)
    expect(hasExplicitIssueViewParams({ display: 'id,labels' })).toBe(true)
    expect(hasExplicitIssueViewParams({ filter: 'status:is:open' })).toBe(true)
  })

  it('normalizes the full projects state independently', () => {
    expect(
      normalizeProjectViewPreference({
        project: '/work/example-project',
        view: 'tree',
        grouping: 'none',
        ordering: 'progress',
        filter: 'status:is:open',
        display: 'id,labels',
      }),
    ).toEqual({
      view: 'tree',
      grouping: 'none',
      ordering: 'progress',
      filter: 'status:is:open',
      display: 'id,labels',
    })
    expect(hasExplicitProjectViewParams({ view: 'list' })).toBe(false)
    expect(hasExplicitProjectViewParams({ view: 'tree' })).toBe(true)
  })
})
