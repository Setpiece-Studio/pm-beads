// ABOUTME: Open-ask queue membership and ordering do not depend on notifications or read state.
import { describe, expect, it } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import { openAskRows } from '../open-ask-rows'

const ask = {
  kind: 'decision',
  q: 'Which option?',
  by: 'coordinator',
  at: '2020-01-01T00:00:00Z',
}
const answered = {
  ...ask,
  answer: 'A',
  answered_by: 'ben',
  answered_at: '2020-01-02T00:00:00Z',
}
function issue(
  id: string,
  metadata?: Issue['metadata'],
  status = 'open',
): Issue {
  return {
    id,
    title: id,
    metadata,
    status,
    priority: 2,
    issue_type: 'task',
    created_at: ask.at,
    updated_at: ask.at,
  }
}
describe('openAskRows', () => {
  it('includes old, deferred, and malformed asks, excluding answered and closed beads', () => {
    const rows = openAskRows(
      [
        issue('old', { 'ask.one': JSON.stringify(ask) }),
        issue('deferred', { 'ask.one': ask }, 'deferred'),
        issue('malformed', { 'ask.one': '{' }),
        issue('answered', { 'ask.one': answered }),
        issue('closed', { 'ask.one': ask }, 'closed'),
        issue('ordinary'),
      ],
      'newest',
    )
    expect(rows.map((row) => row.issueId)).toEqual([
      'deferred',
      'malformed',
      'old',
    ])
    expect(rows.find((row) => row.issueId === 'malformed')?.snippet).toContain(
      'needs repair',
    )
  })
  it('keeps one row until the final ask is answered and previews the open question', () => {
    const metadata = {
      'ask.one': answered,
      'ask.two': { ...ask, q: 'Still waiting?' },
    }
    expect(openAskRows([issue('one', metadata)], 'newest')).toMatchObject([
      { issueId: 'one', snippet: 'Still waiting?', actor: 'coordinator' },
    ])
    expect(
      openAskRows(
        [issue('one', { ...metadata, 'ask.two': answered })],
        'newest',
      ),
    ).toEqual([])
  })
  it('sorts by open ask creation time rather than unrelated issue updates', () => {
    const issues = [
      issue('old', { 'ask.one': ask }),
      issue('new', { 'ask.one': { ...ask, at: '2026-01-01T00:00:00Z' } }),
    ]
    expect(openAskRows(issues, 'newest').map((row) => row.issueId)).toEqual([
      'new',
      'old',
    ])
    expect(openAskRows(issues, 'oldest').map((row) => row.issueId)).toEqual([
      'old',
      'new',
    ])
  })
})
