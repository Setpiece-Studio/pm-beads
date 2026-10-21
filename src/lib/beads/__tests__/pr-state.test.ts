// ABOUTME: Tests for PR state mapping (gh pr view --json → the badge's state) and the
// ABOUTME: soft-failing, ~60s-cached getPrState reader.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearPrStateCacheForTest, mapPrView, readPrState } from '../pr-state'

describe('mapPrView', () => {
  const base = {
    number: 9,
    title: 'Link PRs to beads',
    url: 'https://github.com/o/r/pull/9',
  }

  it('maps an open PR', () => {
    expect(mapPrView({ ...base, state: 'OPEN', isDraft: false })).toEqual({
      url: base.url,
      number: 9,
      title: 'Link PRs to beads',
      state: 'open',
    })
  })

  it('maps a draft PR to draft, not open', () => {
    expect(mapPrView({ ...base, state: 'OPEN', isDraft: true }).state).toBe(
      'draft',
    )
  })

  it('maps a merged PR, and prefers merged over a draft flag', () => {
    expect(mapPrView({ ...base, state: 'MERGED', isDraft: false }).state).toBe(
      'merged',
    )
    expect(
      mapPrView({
        ...base,
        state: 'CLOSED',
        isDraft: true,
        mergedAt: '2026-07-21T17:19:36Z',
      }).state,
    ).toBe('merged')
  })

  it('maps a closed (unmerged) PR', () => {
    expect(
      mapPrView({ ...base, state: 'CLOSED', isDraft: false, mergedAt: null })
        .state,
    ).toBe('closed')
  })

  it('maps an unrecognized or unparsable payload to unknown', () => {
    expect(mapPrView({ ...base, state: 'WAT' }).state).toBe('unknown')
    expect(mapPrView('nonsense').state).toBe('unknown')
  })

  it('keeps title and number optional', () => {
    expect(mapPrView({ state: 'OPEN' })).toEqual({ state: 'open' })
  })
})

describe('readPrState', () => {
  const url = 'https://github.com/o/r/pull/9'

  beforeEach(() => {
    clearPrStateCacheForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the mapped state from the gh reader', async () => {
    const gh = vi
      .fn()
      .mockResolvedValue(
        JSON.stringify({ number: 9, title: 'T', state: 'MERGED', url }),
      )
    await expect(readPrState(url, { gh })).resolves.toEqual({
      url,
      number: 9,
      title: 'T',
      state: 'merged',
    })
    expect(gh).toHaveBeenCalledWith(url, undefined)
  })

  it('fails soft to unknown when gh errors', async () => {
    const gh = vi.fn().mockRejectedValue(new Error('gh: not authenticated'))
    await expect(readPrState(url, { gh })).resolves.toEqual({
      url,
      state: 'unknown',
    })
  })

  it('fails soft to unknown when gh prints something that is not JSON', async () => {
    const gh = vi.fn().mockResolvedValue('not json')
    await expect(readPrState(url, { gh })).resolves.toEqual({
      url,
      state: 'unknown',
    })
  })

  it('caches per url and re-reads once the entry expires', async () => {
    vi.useFakeTimers()
    try {
      const gh = vi
        .fn()
        .mockResolvedValue(JSON.stringify({ state: 'OPEN', url }))
      await readPrState(url, { gh })
      await readPrState(url, { gh })
      await readPrState('https://github.com/o/r/pull/10', { gh })
      expect(gh).toHaveBeenCalledTimes(2)

      vi.advanceTimersByTime(61_000)
      await readPrState(url, { gh })
      expect(gh).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a url that is not a github PR url without calling gh', async () => {
    const gh = vi.fn()
    await expect(readPrState('https://example.com/x', { gh })).resolves.toEqual(
      {
        url: 'https://example.com/x',
        state: 'unknown',
      },
    )
    expect(gh).not.toHaveBeenCalled()
  })
})
