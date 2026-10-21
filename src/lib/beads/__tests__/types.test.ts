// ABOUTME: Unit tests for the beads zod schemas, parsing captured fixture JSON from real bd output.
// ABOUTME: Fixtures live in ./fixtures and were captured from this repo's live db and a probe db.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  commentSchema,
  epicStatusSchema,
  isKnownIssueType,
  isKnownStatus,
  issueSchema,
  showIssueSchema,
} from '../types'

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf-8'))
}

describe('issueSchema', () => {
  it('parses every element of real bd list --json output', () => {
    const raw = fixture('list.json') as unknown[]
    expect(raw.length).toBeGreaterThan(0)
    for (const element of raw) {
      const issue = issueSchema.parse(element)
      expect(issue.id).toMatch(/^pm-beads-/)
      expect(typeof issue.priority).toBe('number')
    }
  })

  it('treats absent optional fields as undefined, not null', () => {
    const raw = fixture('list.json') as Record<string, unknown>[]
    const noLabels = raw.find((i) => !('labels' in i))
    expect(noLabels).toBeDefined()
    const parsed = issueSchema.parse(noLabels)
    expect(parsed.labels).toBeUndefined()
    expect(
      parsed.assignee === undefined || typeof parsed.assignee === 'string',
    ).toBe(true)
  })

  it('parses dependency edges with metadata as a JSON string', () => {
    const raw = fixture('list.json') as Record<string, unknown>[]
    const withDeps = raw.find((i) => Array.isArray(i.dependencies))
    expect(withDeps).toBeDefined()
    const parsed = issueSchema.parse(withDeps)
    const dep = parsed.dependencies?.[0]
    expect(dep?.issue_id).toBeTruthy()
    expect(dep?.depends_on_id).toBeTruthy()
    expect(typeof dep?.metadata).toBe('string')
  })

  it('accepts unknown custom statuses gracefully', () => {
    const raw = (fixture('list.json') as Record<string, unknown>[])[0]
    const custom = issueSchema.parse({ ...raw, status: 'some_custom_status' })
    expect(custom.status).toBe('some_custom_status')
  })

  it('parses issue metadata as a flat typed object, absent or null meaning none', () => {
    const raw = (fixture('list.json') as Record<string, unknown>[])[0]
    const parsed = issueSchema.parse({
      ...raw,
      metadata: { pr_url: 'https://github.com/o/r/pull/9', rank: 3, ok: true },
    })
    expect(parsed.metadata).toEqual({
      pr_url: 'https://github.com/o/r/pull/9',
      rank: 3,
      ok: true,
    })
    expect(
      issueSchema.parse({ ...raw, metadata: null }).metadata,
    ).toBeUndefined()
    expect(issueSchema.parse(raw).metadata).toBeUndefined()
  })

  it('parses bd create --json output (single object)', () => {
    const created = issueSchema.parse(fixture('create.json'))
    expect(created.status).toBe('open')
    expect(created.description).toBe('desc')
  })

  it('preserves structured metadata in project lists and issue details', () => {
    const raw = (fixture('list.json') as Record<string, unknown>[])[0]
    const metadata = {
      'ask.reauth': {
        kind: 'action',
        steps: ['Sign in'],
        nested: { ok: true },
      },
      values: [1, 'two', null, { enabled: false }],
      empty: null,
    }
    const record = { ...raw, metadata }
    expect(issueSchema.array().parse([raw, record])[1]?.metadata).toEqual(
      metadata,
    )
    expect(
      showIssueSchema.parse({ ...record, dependencies: undefined }).metadata,
    ).toEqual(metadata)
  })
})

describe('isKnownStatus', () => {
  it('recognizes the five built-in statuses', () => {
    for (const s of ['open', 'in_progress', 'blocked', 'deferred', 'closed']) {
      expect(isKnownStatus(s)).toBe(true)
    }
  })

  it('rejects custom statuses', () => {
    expect(isKnownStatus('some_custom_status')).toBe(false)
  })
})

describe('isKnownIssueType', () => {
  it('recognizes the built-in issue types including decision', () => {
    for (const t of ['task', 'bug', 'feature', 'epic', 'chore', 'decision']) {
      expect(isKnownIssueType(t)).toBe(true)
    }
  })

  it('rejects custom types', () => {
    expect(isKnownIssueType('spike')).toBe(false)
  })
})

describe('showIssueSchema', () => {
  it('parses bd show --json elements with full-issue dependencies and dependents', () => {
    const raw = fixture('show.json') as unknown[]
    expect(raw).toHaveLength(1)
    const issue = showIssueSchema.parse(raw[0])
    expect(issue.id).toBe('pm-beads-c55')
    // bd show embeds linked issues as full issues with a dependency_type field
    for (const linked of [
      ...(issue.dependencies ?? []),
      ...(issue.dependents ?? []),
    ]) {
      expect(linked.id).toMatch(/^pm-beads-/)
      expect(typeof linked.dependency_type).toBe('string')
    }
  })

  it('tolerates explicit null for dependencies/dependents/comments (KTD14)', () => {
    const base = (fixture('show.json') as Record<string, unknown>[])[0]
    const withNulls = {
      ...base,
      dependencies: null,
      dependents: null,
      comments: null,
    }
    const issue = showIssueSchema.parse(withNulls)
    expect(issue.dependencies).toBeUndefined()
    expect(issue.dependents).toBeUndefined()
    expect(issue.comments).toBeUndefined()
  })

  it('still treats absent linked-issue arrays as undefined', () => {
    const base = (fixture('show.json') as Record<string, unknown>[])[0]
    const { dependencies, dependents, comments, ...withoutArrays } = base
    const issue = showIssueSchema.parse(withoutArrays)
    expect(issue.dependencies).toBeUndefined()
    expect(issue.dependents).toBeUndefined()
    expect(issue.comments).toBeUndefined()
  })
})

describe('epicStatusSchema', () => {
  it('parses bd epic status --json output', () => {
    const raw = fixture('epic-status.json') as unknown[]
    expect(raw.length).toBeGreaterThan(0)
    for (const element of raw) {
      const epic = epicStatusSchema.parse(element)
      expect(epic.epic.issue_type).toBe('epic')
      expect(typeof epic.total_children).toBe('number')
      expect(typeof epic.closed_children).toBe('number')
      expect(typeof epic.eligible_for_close).toBe('boolean')
    }
  })
})

describe('commentSchema', () => {
  it('parses bd comments --json output', () => {
    const raw = fixture('comments.json') as unknown[]
    expect(raw.length).toBeGreaterThan(0)
    for (const element of raw) {
      const comment = commentSchema.parse(element)
      expect(comment.issue_id).toBe('pm-beads-c55')
      expect(comment.text.length).toBeGreaterThan(0)
      expect(comment.author.length).toBeGreaterThan(0)
    }
  })
})
