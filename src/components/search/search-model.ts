// ABOUTME: Pure global-search matching and ranking over the Beads objects already cached by
// ABOUTME: the app, shared by the search route and focused unit tests.

import type { Issue, Memory } from '@/lib/beads/types'

export const searchKinds = ['all', 'issues', 'projects', 'memories'] as const
export type SearchKind = (typeof searchKinds)[number]
export type SearchObjectKind = Exclude<SearchKind, 'all'>

export interface SearchResult {
  kind: SearchObjectKind
  id: string
  title: string
  description: string
  status?: string
  priority?: number
  labels?: string[]
}

function searchableIssueText(issue: Issue): string {
  return [
    issue.id,
    issue.title,
    issue.description,
    issue.notes,
    issue.design,
    issue.acceptance_criteria,
    issue.assignee,
    ...(issue.labels ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
}

function searchableMemoryText(memory: Memory): string {
  return `${memory.key} ${memory.value}`.toLocaleLowerCase()
}

function matchRank(primary: string, fullText: string, query: string): number {
  const normalized = primary.toLocaleLowerCase()
  if (normalized === query) return 0
  if (normalized.startsWith(query)) return 1
  if (normalized.includes(query)) return 2
  if (fullText.includes(query)) return 3
  return Number.POSITIVE_INFINITY
}

export function searchObjects(
  issues: readonly Issue[],
  memories: readonly Memory[],
  rawQuery: string,
  kind: SearchKind = 'all',
): SearchResult[] {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (query === '') return []

  const matches: Array<SearchResult & { rank: number; updatedAt: string }> = []

  if (kind === 'all' || kind === 'issues' || kind === 'projects') {
    for (const issue of issues) {
      const objectKind = issue.issue_type === 'epic' ? 'projects' : 'issues'
      if (kind !== 'all' && kind !== objectKind) continue
      const text = searchableIssueText(issue)
      const rank = Math.min(
        matchRank(issue.title, text, query),
        matchRank(issue.id, text, query),
      )
      if (!Number.isFinite(rank)) continue
      matches.push({
        kind: objectKind,
        id: issue.id,
        title: issue.title,
        description: issue.description ?? '',
        status: issue.status,
        priority: issue.priority,
        labels: issue.labels,
        rank,
        updatedAt: issue.updated_at,
      })
    }
  }

  if (kind === 'all' || kind === 'memories') {
    for (const memory of memories) {
      const rank = matchRank(memory.key, searchableMemoryText(memory), query)
      if (!Number.isFinite(rank)) continue
      matches.push({
        kind: 'memories',
        id: memory.key,
        title: memory.key,
        description: memory.value,
        rank,
        updatedAt: '',
      })
    }
  }

  return matches
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.title.localeCompare(b.title),
    )
    .map(({ rank: _rank, updatedAt: _updatedAt, ...result }) => result)
}
