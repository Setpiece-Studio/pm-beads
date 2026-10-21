// ABOUTME: Tests for the pure PR-reference helpers — parsing GitHub PR URLs, parsing https/ssh
// ABOUTME: origin remotes, and resolving typed input against one (no git, no network).

import { describe, expect, it } from 'vitest'

import {
  isPossiblePrRef,
  PR_URL_METADATA_KEY,
  parseGitRemoteUrl,
  parsePrNumber,
  parsePrUrl,
  prRefUrl,
  prUrlOf,
  resolvePrRefWith,
  shortPrLabel,
} from '../pr-link'

describe('parsePrUrl', () => {
  it('parses a canonical https PR url', () => {
    expect(
      parsePrUrl('https://github.com/example-owner/pm-beads/pull/9'),
    ).toEqual({
      owner: 'example-owner',
      repo: 'pm-beads',
      number: 9,
    })
  })

  it('tolerates http, www, a trailing slash, and surrounding whitespace', () => {
    expect(parsePrUrl('  http://www.github.com/o/r/pull/12/  ')).toEqual({
      owner: 'o',
      repo: 'r',
      number: 12,
    })
  })

  it('parses a deep link into the PR (files tab, comment anchor, query)', () => {
    expect(
      parsePrUrl('https://github.com/o/r/pull/12/files?w=1#issuecomment-5'),
    ).toEqual({ owner: 'o', repo: 'r', number: 12 })
  })

  it('rejects non-PR github urls, other hosts, and nonsense', () => {
    expect(parsePrUrl('https://github.com/o/r/issues/12')).toBeNull()
    expect(parsePrUrl('https://gitlab.com/o/r/pull/12')).toBeNull()
    expect(parsePrUrl('https://github.com/o/r')).toBeNull()
    expect(parsePrUrl('not a url')).toBeNull()
    expect(parsePrUrl('')).toBeNull()
  })
})

describe('parsePrNumber', () => {
  it('accepts a bare number and a #-prefixed number', () => {
    expect(parsePrNumber('42')).toBe(42)
    expect(parsePrNumber('#42')).toBe(42)
    expect(parsePrNumber('  #42 ')).toBe(42)
  })

  it('rejects zero, negatives, non-integers, and anything else', () => {
    expect(parsePrNumber('0')).toBeNull()
    expect(parsePrNumber('-3')).toBeNull()
    expect(parsePrNumber('4.5')).toBeNull()
    expect(parsePrNumber('#')).toBeNull()
    expect(parsePrNumber('abc')).toBeNull()
  })
})

describe('parseGitRemoteUrl', () => {
  it('parses https remotes with and without .git', () => {
    expect(
      parseGitRemoteUrl('https://github.com/example-owner/pm-beads.git'),
    ).toEqual({ owner: 'example-owner', repo: 'pm-beads' })
    expect(
      parseGitRemoteUrl('https://github.com/example-owner/pm-beads'),
    ).toEqual({
      owner: 'example-owner',
      repo: 'pm-beads',
    })
  })

  it('parses scp-style and ssh:// remotes', () => {
    expect(
      parseGitRemoteUrl('git@github.com:example-owner/pm-beads.git'),
    ).toEqual({
      owner: 'example-owner',
      repo: 'pm-beads',
    })
    expect(
      parseGitRemoteUrl('ssh://git@github.com/example-owner/pm-beads.git'),
    ).toEqual({ owner: 'example-owner', repo: 'pm-beads' })
  })

  it('trims the trailing newline git prints', () => {
    expect(parseGitRemoteUrl('git@github.com:o/r.git\n')).toEqual({
      owner: 'o',
      repo: 'r',
    })
  })

  it('rejects non-github and malformed remotes', () => {
    expect(parseGitRemoteUrl('git@gitlab.com:o/r.git')).toBeNull()
    expect(parseGitRemoteUrl('https://github.com/o')).toBeNull()
    expect(parseGitRemoteUrl('')).toBeNull()
  })
})

describe('resolvePrRefWith', () => {
  it('resolves a full url without consulting the remote', () => {
    expect(
      resolvePrRefWith('https://github.com/o/r/pull/7/files', null),
    ).toEqual({ owner: 'o', repo: 'r', number: 7 })
  })

  it('resolves a bare number against the origin remote', () => {
    expect(resolvePrRefWith('7', 'git@github.com:o/r.git')).toEqual({
      owner: 'o',
      repo: 'r',
      number: 7,
    })
    expect(resolvePrRefWith('#7', 'https://github.com/o/r')).toEqual({
      owner: 'o',
      repo: 'r',
      number: 7,
    })
  })

  it('explains that a bare number needs a github origin remote', () => {
    expect(() => resolvePrRefWith('7', null)).toThrow(/origin remote/i)
    expect(() => resolvePrRefWith('7', 'git@gitlab.com:o/r.git')).toThrow(
      /origin remote/i,
    )
  })

  it('rejects input that is neither a PR url nor a number', () => {
    expect(() => resolvePrRefWith('nope', 'git@github.com:o/r.git')).toThrow(
      /pull request url or number/i,
    )
  })
})

describe('prRefUrl', () => {
  it('formats a ref as the canonical PR url', () => {
    expect(prRefUrl({ owner: 'o', repo: 'r', number: 7 })).toBe(
      'https://github.com/o/r/pull/7',
    )
  })
})

describe('isPossiblePrRef', () => {
  it('accepts what resolvePrRefWith could resolve, rejects the rest', () => {
    expect(isPossiblePrRef('https://github.com/o/r/pull/7')).toBe(true)
    expect(isPossiblePrRef('7')).toBe(true)
    expect(isPossiblePrRef('#7')).toBe(true)
    expect(isPossiblePrRef('nope')).toBe(false)
    expect(isPossiblePrRef('   ')).toBe(false)
  })
})

describe('shortPrLabel', () => {
  it('falls back to owner/repo#N from the url when gh has no title', () => {
    expect(shortPrLabel('https://github.com/o/r/pull/7')).toBe('o/r#7')
  })

  it('returns the url unchanged when it is not a PR url', () => {
    expect(shortPrLabel('https://example.com/thing')).toBe(
      'https://example.com/thing',
    )
  })
})

describe('prUrlOf', () => {
  const base = {
    id: 'pm-1',
    title: 't',
    status: 'open',
    priority: 1,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  }

  it('reads the pr_url metadata key', () => {
    expect(prUrlOf({ ...base, metadata: { pr_url: 'https://x/pull/1' } })).toBe(
      'https://x/pull/1',
    )
    expect(PR_URL_METADATA_KEY).toBe('pr_url')
  })

  it('is undefined when metadata is absent, empty, or non-string', () => {
    expect(prUrlOf(base)).toBeUndefined()
    expect(prUrlOf({ ...base, metadata: {} })).toBeUndefined()
    expect(prUrlOf({ ...base, metadata: { pr_url: 7 } })).toBeUndefined()
  })
})
