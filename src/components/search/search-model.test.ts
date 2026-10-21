// ABOUTME: Unit coverage for global object search across issues, epics, and memories, including
// ABOUTME: type filtering and relevance ordering.

import { describe, expect, it } from 'vitest'
import type { Issue, Memory } from '@/lib/beads/types'
import { searchObjects } from './search-model'

function issue(patch: Partial<Issue> = {}): Issue {
  return {
    id: 'pm-beads-1',
    title: 'Improve global search',
    status: 'open',
    priority: 2,
    issue_type: 'feature',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-02T00:00:00Z',
    ...patch,
  }
}

const memories: Memory[] = [
  { key: 'search-guidance', value: 'Prefer cached reads for global search.' },
]

describe('searchObjects', () => {
  it('searches issue fields, epics as projects, and memory contents', () => {
    const issues = [
      issue({ labels: ['navigation'] }),
      issue({ id: 'pm-beads-2', title: 'Search roadmap', issue_type: 'epic' }),
    ]

    expect(
      searchObjects(issues, memories, 'search').map((item) => item.kind),
    ).toEqual(['projects', 'memories', 'issues'])
  })

  it('limits results to the selected object kind', () => {
    const issues = [
      issue(),
      issue({ id: 'pm-beads-2', title: 'Search roadmap', issue_type: 'epic' }),
    ]

    expect(searchObjects(issues, memories, 'search', 'projects')).toEqual([
      expect.objectContaining({ id: 'pm-beads-2', kind: 'projects' }),
    ])
  })

  it('returns no objects until a query is entered', () => {
    expect(searchObjects([issue()], memories, '   ')).toEqual([])
  })
})
