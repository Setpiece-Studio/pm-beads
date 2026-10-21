// ABOUTME: Unit tests for saved-view param normalization — default stripping, canonical
// ABOUTME: display/filter round-trips, route key allowlists, equality, and id generation.

import { describe, expect, it } from 'vitest'
import {
  generateViewId,
  normalizeViewParams,
  viewParamsEqual,
} from './view-params'

describe('normalizeViewParams (issues)', () => {
  it('returns empty params for the default view', () => {
    expect(
      normalizeViewParams('issues', {
        grouping: 'status',
        ordering: 'priority',
      }),
    ).toEqual({})
  })

  it('strips the list view default but keeps board', () => {
    expect(normalizeViewParams('issues', { view: 'list' })).toEqual({})
    expect(normalizeViewParams('issues', { view: 'board' })).toEqual({
      view: 'board',
    })
  })

  it('keeps non-default grouping and ordering, drops unknown values', () => {
    expect(
      normalizeViewParams('issues', {
        grouping: 'project',
        ordering: 'updated',
      }),
    ).toEqual({ grouping: 'project', ordering: 'updated' })
    expect(
      normalizeViewParams('issues', { grouping: 'bogus', ordering: 'bogus' }),
    ).toEqual({})
  })

  it('never passes project or issue through', () => {
    expect(
      normalizeViewParams('issues', {
        project: '/some/dir',
        issue: 'abc-123',
        view: 'board',
      }),
    ).toEqual({ view: 'board' })
  })

  it('canonicalizes the display param and omits the default set', () => {
    // The default property set serializes to undefined.
    expect(
      normalizeViewParams('issues', {
        display: 'priority,id,status,labels,project,updated',
      }),
    ).toEqual({})
    // Non-canonical order and unknown names collapse to canonical order.
    expect(
      normalizeViewParams('issues', { display: 'status,priority,nonsense' }),
    ).toEqual({ display: 'priority,status' })
  })

  it('canonicalizes the filter param and omits empty filters', () => {
    expect(normalizeViewParams('issues', { filter: '' })).toEqual({})
    expect(normalizeViewParams('issues', { filter: 'garbage' })).toEqual({})
    // Duplicate values dedupe; invalid clauses drop.
    expect(
      normalizeViewParams('issues', {
        filter: 'status:is:open,open;bogus:is:x',
      }),
    ).toEqual({ filter: 'status:is:open' })
  })
})

describe('normalizeViewParams (projects)', () => {
  it('drops issues-only keys, keeping the projects view shape', () => {
    // Board is shared; grouping by project remains issues-only.
    expect(
      normalizeViewParams('projects', {
        filter: 'priority:is:1',
        grouping: 'project',
        view: 'board',
        issue: 'abc-1',
      }),
    ).toEqual({ view: 'board', filter: 'priority:is:1' })
  })

  it('keeps non-default grouping and ordering from the projects vocabulary', () => {
    expect(
      normalizeViewParams('projects', {
        grouping: 'none',
        ordering: 'blocking',
      }),
    ).toEqual({ grouping: 'none', ordering: 'blocking' })
  })

  it('strips the grouping and ordering defaults', () => {
    expect(
      normalizeViewParams('projects', {
        grouping: 'status',
        ordering: 'priority',
      }),
    ).toEqual({})
  })

  it('drops orderings that are valid for issues but not projects', () => {
    // 'status' is an issues ordering; projects group by status so it is not offered.
    expect(normalizeViewParams('projects', { ordering: 'status' })).toEqual({})
    expect(normalizeViewParams('projects', { ordering: 'progress' })).toEqual({
      ordering: 'progress',
    })
  })

  it('omits an empty filter', () => {
    expect(normalizeViewParams('projects', {})).toEqual({})
  })
})

describe('viewParamsEqual', () => {
  it('treats explicit defaults as equal to absent params', () => {
    expect(
      viewParamsEqual(
        'issues',
        { grouping: 'status', ordering: 'priority' },
        {},
      ),
    ).toBe(true)
  })

  it('detects differing filters', () => {
    expect(
      viewParamsEqual(
        'issues',
        { filter: 'status:is:open' },
        { filter: 'status:is:closed' },
      ),
    ).toBe(false)
  })

  it('matches saved params against a live URL with extra route params', () => {
    expect(
      viewParamsEqual(
        'issues',
        { view: 'board', filter: 'type:is:bug' },
        {
          view: 'board',
          filter: 'type:is:bug',
          grouping: 'status',
          ordering: 'priority',
          project: '/x',
          issue: 'abc-9',
        },
      ),
    ).toBe(true)
  })

  it('compares only the filter on the projects route', () => {
    expect(
      viewParamsEqual(
        'projects',
        { filter: 'priority:is:1', grouping: 'label' },
        { filter: 'priority:is:1' },
      ),
    ).toBe(true)
  })
})

describe('generateViewId', () => {
  it('uses the injected id source', () => {
    expect(generateViewId(() => 'fixed-id')).toBe('fixed-id')
  })

  it('defaults to a non-empty unique id', () => {
    const a = generateViewId()
    const b = generateViewId()
    expect(a).not.toBe('')
    expect(a).not.toBe(b)
  })
})
