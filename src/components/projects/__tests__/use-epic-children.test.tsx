// ABOUTME: Tests for the useEpicChildren hook — expand/collapse state, lazy fetching of
// ABOUTME: an epic's child issues on first expand, and per-epic caching across toggles.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import { useEpicChildren } from '../use-epic-children'

function makeIssue(id: string): Issue {
  return {
    id,
    title: `Issue ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
  }
}

describe('useEpicChildren', () => {
  afterEach(cleanup)

  it('starts with nothing expanded', () => {
    const { result } = renderHook(() => useEpicChildren(vi.fn()))
    expect(result.current.isExpanded('e1')).toBe(false)
  })

  it('expands and collapses an epic on toggle', async () => {
    const fetcher = vi.fn().mockResolvedValue([])
    const { result } = renderHook(() => useEpicChildren(fetcher))

    act(() => result.current.toggle('e1'))
    expect(result.current.isExpanded('e1')).toBe(true)
    expect(result.current.isExpanded('e2')).toBe(false)

    act(() => result.current.toggle('e1'))
    expect(result.current.isExpanded('e1')).toBe(false)
  })

  it('fetches children lazily on first expand and stores them', async () => {
    const kids = [makeIssue('k1'), makeIssue('k2')]
    const fetcher = vi.fn().mockResolvedValue(kids)
    const { result } = renderHook(() => useEpicChildren(fetcher))

    expect(fetcher).not.toHaveBeenCalled()
    act(() => result.current.toggle('e1'))
    expect(result.current.isLoading('e1')).toBe(true)

    await waitFor(() => expect(result.current.children('e1')).toEqual(kids))
    expect(result.current.isLoading('e1')).toBe(false)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('e1')
  })

  it('fetches only once per epic across collapse/re-expand', async () => {
    const fetcher = vi.fn().mockResolvedValue([makeIssue('k1')])
    const { result } = renderHook(() => useEpicChildren(fetcher))

    act(() => result.current.toggle('e1'))
    await waitFor(() => expect(result.current.children('e1')).toHaveLength(1))

    act(() => result.current.toggle('e1')) // collapse
    act(() => result.current.toggle('e1')) // re-expand
    act(() => result.current.toggle('e1')) // collapse
    act(() => result.current.toggle('e1')) // re-expand
    await waitFor(() => expect(result.current.isExpanded('e1')).toBe(true))

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('tracks fetches independently per epic', async () => {
    const fetcher = vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve([makeIssue(`${id}-kid`)]),
      )
    const { result } = renderHook(() => useEpicChildren(fetcher))

    act(() => result.current.toggle('e1'))
    act(() => result.current.toggle('e2'))
    await waitFor(() => {
      expect(result.current.children('e1')).toHaveLength(1)
      expect(result.current.children('e2')).toHaveLength(1)
    })

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.current.children('e1')?.[0]?.id).toBe('e1-kid')
    expect(result.current.children('e2')?.[0]?.id).toBe('e2-kid')
  })

  it('records an error and stops loading when the fetch fails', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('bd exploded'))
    const { result } = renderHook(() => useEpicChildren(fetcher))

    act(() => result.current.toggle('e1'))
    await waitFor(() => expect(result.current.error('e1')).toBe('bd exploded'))
    expect(result.current.isLoading('e1')).toBe(false)
    expect(result.current.children('e1')).toBeUndefined()
  })
})
