// ABOUTME: Tests for the write-only useIssueEdits hook (KTD8) — seeds from the loader's issue,
// ABOUTME: never reads on mount, and applies every mutation's returned fresh issue (one bd read).

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, type Mock, vi } from 'vitest'
import type { ShowIssue } from '@/lib/beads/types'
import { type IssueEditDeps, useIssueEdits } from '../use-issue-edits'

function makeIssue(overrides: Partial<ShowIssue> = {}): ShowIssue {
  return {
    id: 'pm-1',
    title: 'Test issue',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    ...overrides,
  }
}

type MockedDeps = { [K in keyof IssueEditDeps]: Mock<IssueEditDeps[K]> }

// Every write now returns the fresh ShowIssue (server-side read after the write), so the rail
// applies it directly. The mocks default to returning the seed issue; tests override per-action.
function makeDeps(issue: ShowIssue): MockedDeps {
  return {
    getIssue: vi.fn().mockResolvedValue(issue),
    answerAsk: vi.fn().mockResolvedValue(issue),
    updateIssue: vi.fn().mockResolvedValue(issue),
    saveTextField: vi.fn().mockResolvedValue({ ok: true, issue }),
    closeIssue: vi.fn().mockResolvedValue(issue),
    addLabel: vi.fn().mockResolvedValue(issue),
    removeLabel: vi.fn().mockResolvedValue(issue),
    addDependency: vi.fn().mockResolvedValue(issue),
    removeDependency: vi.fn().mockResolvedValue(issue),
    relate: vi.fn().mockResolvedValue(issue),
    unrelate: vi.fn().mockResolvedValue(issue),
    getActivity: vi.fn().mockResolvedValue({
      events: [],
      comments: issue.comments ?? [],
      messages: [],
      historyUnavailable: false,
    }),
    addComment: vi.fn().mockResolvedValue({
      events: [],
      comments: issue.comments ?? [],
      messages: [],
      historyUnavailable: false,
    }),
    listCandidates: vi.fn().mockResolvedValue([]),
    createSubIssue: vi.fn().mockResolvedValue(issue),
    setPrUrl: vi.fn().mockResolvedValue(issue),
    clearPrUrl: vi.fn().mockResolvedValue(issue),
    getPrState: vi
      .fn()
      .mockImplementation(async (url: string) => ({ url, state: 'unknown' })),
  }
}

describe('useIssueEdits', () => {
  it('seeds local state from the loader issue without reading on mount', () => {
    const issue = makeIssue()
    const deps = makeDeps(issue)
    const { result } = renderHook(() => useIssueEdits(issue, deps))

    expect(result.current.issue).toEqual(issue)
    expect(result.current.saving).toBe(false)
    // KTD8: the loader owns the read — no getIssue-on-mount.
    expect(deps.getIssue).not.toHaveBeenCalled()
  })

  it('re-syncs local state when the loader hands a new issue id', () => {
    const deps = makeDeps(makeIssue())
    const { result, rerender } = renderHook(
      ({ issue }: { issue: ShowIssue }) => useIssueEdits(issue, deps),
      { initialProps: { issue: makeIssue() } },
    )
    expect(result.current.issue.id).toBe('pm-1')

    const second = makeIssue({ id: 'pm-2', title: 'Second' })
    rerender({ issue: second })
    expect(result.current.issue.id).toBe('pm-2')
    expect(result.current.issue.title).toBe('Second')
  })

  it('keeps optimistic local state across re-renders with the same id', async () => {
    const deps = makeDeps(makeIssue())
    const { result, rerender } = renderHook(
      ({ issue }: { issue: ShowIssue }) => useIssueEdits(issue, deps),
      { initialProps: { issue: makeIssue() } },
    )

    deps.updateIssue.mockResolvedValue(makeIssue({ status: 'in_progress' }))
    await act(() => result.current.actions.setStatus('in_progress'))
    expect(result.current.issue.status).toBe('in_progress')

    // A re-render with the same id (e.g. a parent re-render) must not clobber the edit.
    rerender({ issue: makeIssue() })
    expect(result.current.issue.status).toBe('in_progress')
  })

  it('applies a completed same-ID loader revision after an external refresh', () => {
    const deps = makeDeps(makeIssue())
    const { result, rerender } = renderHook(
      ({ issue, revision }: { issue: ShowIssue; revision: number }) =>
        useIssueEdits(issue, deps, undefined, revision),
      { initialProps: { issue: makeIssue(), revision: 1 } },
    )
    rerender({ issue: makeIssue({ status: 'closed' }), revision: 2 })
    expect(result.current.issue.status).toBe('closed')
  })

  it('setStatus applies the returned fresh issue and notifies onMutated', async () => {
    const deps = makeDeps(makeIssue())
    const onMutated = vi.fn()
    const { result } = renderHook(() =>
      useIssueEdits(makeIssue(), deps, onMutated),
    )

    deps.updateIssue.mockResolvedValue(makeIssue({ status: 'in_progress' }))
    await act(() => result.current.actions.setStatus('in_progress'))

    expect(deps.updateIssue).toHaveBeenCalledWith('pm-1', {
      status: 'in_progress',
    })
    expect(result.current.issue.status).toBe('in_progress')
    expect(onMutated).toHaveBeenCalledTimes(1)
    // Fast path: the returned issue is applied, no extra getIssue read.
    expect(deps.getIssue).not.toHaveBeenCalled()
  })

  it('answerAsk applies the returned metadata and status', async () => {
    const issue = makeIssue({ status: 'blocked' })
    const answered = makeIssue({
      status: 'open',
      metadata: { 'ask.storage': '{"answer":"one JSON string"}' },
    })
    const deps = makeDeps(issue)
    deps.answerAsk.mockResolvedValue(answered)
    const { result } = renderHook(() => useIssueEdits(issue, deps))

    await act(() =>
      result.current.actions.answerAsk('storage', 'one JSON string'),
    )

    expect(deps.answerAsk).toHaveBeenCalledWith(
      'pm-1',
      'storage',
      'one JSON string',
    )
    expect(result.current.issue).toEqual(answered)
    expect(deps.getIssue).not.toHaveBeenCalled()
  })

  it('setPriority and setAssignee call updateIssue with the right fields', async () => {
    const deps = makeDeps(makeIssue())
    const { result } = renderHook(() => useIssueEdits(makeIssue(), deps))

    await act(() => result.current.actions.setPriority(0))
    expect(deps.updateIssue).toHaveBeenCalledWith('pm-1', { priority: 0 })

    await act(() => result.current.actions.setAssignee('ben'))
    expect(deps.updateIssue).toHaveBeenCalledWith('pm-1', { assignee: 'ben' })
  })

  it('setType calls updateIssue with the issue_type field', async () => {
    const deps = makeDeps(makeIssue())
    const { result } = renderHook(() => useIssueEdits(makeIssue(), deps))

    deps.updateIssue.mockResolvedValue(makeIssue({ issue_type: 'bug' }))
    await act(() => result.current.actions.setType('bug'))

    expect(deps.updateIssue).toHaveBeenCalledWith('pm-1', { issue_type: 'bug' })
    expect(result.current.issue.issue_type).toBe('bug')
  })

  it('addLabel and removeLabel apply the returned issue without a separate getIssue', async () => {
    const deps = makeDeps(makeIssue())
    const onMutated = vi.fn()
    const { result } = renderHook(() =>
      useIssueEdits(makeIssue(), deps, onMutated),
    )

    deps.addLabel.mockResolvedValue(makeIssue({ labels: ['web'] }))
    await act(() => result.current.actions.addLabel('web'))
    expect(deps.addLabel).toHaveBeenCalledWith('pm-1', 'web')
    expect(result.current.issue.labels).toEqual(['web'])

    deps.removeLabel.mockResolvedValue(makeIssue({ labels: [] }))
    await act(() => result.current.actions.removeLabel('web'))
    expect(deps.removeLabel).toHaveBeenCalledWith('pm-1', 'web')
    expect(result.current.issue.labels).toEqual([])
    expect(onMutated).toHaveBeenCalledTimes(2)
    // Fast path: the returned issue is applied, no extra serialized getIssue read.
    expect(deps.getIssue).not.toHaveBeenCalled()
  })

  it('setPrUrl passes the raw ref through and applies the returned issue', async () => {
    const deps = makeDeps(makeIssue())
    const onMutated = vi.fn()
    const { result } = renderHook(() =>
      useIssueEdits(makeIssue(), deps, onMutated),
    )

    const linked = makeIssue({
      metadata: { pr_url: 'https://github.com/o/r/pull/42' },
    })
    deps.setPrUrl.mockResolvedValue(linked)
    // "#42" goes through unresolved: only the server can read the project's origin remote.
    await act(() => result.current.actions.setPrUrl('#42'))

    expect(deps.setPrUrl).toHaveBeenCalledWith('pm-1', '#42')
    expect(result.current.issue.metadata?.pr_url).toBe(
      'https://github.com/o/r/pull/42',
    )
    expect(onMutated).toHaveBeenCalledTimes(1)
    expect(deps.getIssue).not.toHaveBeenCalled()
  })

  it('clearPrUrl drops the link and surfaces a rejection on the error line', async () => {
    const deps = makeDeps(
      makeIssue({ metadata: { pr_url: 'https://github.com/o/r/pull/42' } }),
    )
    const { result } = renderHook(() =>
      useIssueEdits(
        makeIssue({ metadata: { pr_url: 'https://github.com/o/r/pull/42' } }),
        deps,
      ),
    )

    deps.clearPrUrl.mockResolvedValue(makeIssue())
    await act(() => result.current.actions.clearPrUrl())
    expect(deps.clearPrUrl).toHaveBeenCalledWith('pm-1')
    expect(result.current.issue.metadata).toBeUndefined()

    deps.setPrUrl.mockRejectedValue(
      new Error('#42 needs a GitHub origin remote'),
    )
    await act(() => result.current.actions.setPrUrl('#42'))
    expect(result.current.error).toMatch(/origin remote/)
  })

  it('exposes the injected PR-state reader for the rail', () => {
    const deps = makeDeps(makeIssue())
    const { result } = renderHook(() => useIssueEdits(makeIssue(), deps))
    expect(result.current.getPrState).toBe(deps.getPrState)
  })

  it('close calls closeIssue and applies the closed issue', async () => {
    const deps = makeDeps(makeIssue())
    const onMutated = vi.fn()
    const { result } = renderHook(() =>
      useIssueEdits(makeIssue(), deps, onMutated),
    )

    deps.closeIssue.mockResolvedValue(makeIssue({ status: 'closed' }))
    await act(() => result.current.actions.close())
    expect(deps.closeIssue).toHaveBeenCalledWith('pm-1', undefined)
    expect(result.current.issue.status).toBe('closed')
    expect(onMutated).toHaveBeenCalledTimes(1)
  })

  it('addDependency applies the returned fresh issue and notifies onMutated', async () => {
    const deps = makeDeps(makeIssue())
    const onMutated = vi.fn()
    const { result } = renderHook(() =>
      useIssueEdits(makeIssue(), deps, onMutated),
    )

    // A Blocked by ("down") add reads back the rail issue: its id matches, so it applies directly.
    deps.addDependency.mockResolvedValue(
      makeIssue({
        dependencies: [
          {
            id: 'pm-9',
            title: 'Blocker',
            status: 'open',
            priority: 2,
            issue_type: 'task',
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-10T00:00:00Z',
            dependency_type: 'blocks',
          },
        ],
      }),
    )
    await act(() =>
      result.current.actions.addDependency('pm-1', 'pm-9', 'blocks'),
    )

    expect(deps.addDependency).toHaveBeenCalledWith('pm-1', 'pm-9', 'blocks')
    expect(result.current.issue.dependencies?.[0]?.id).toBe('pm-9')
    expect(onMutated).toHaveBeenCalledTimes(1)
    // Fast path: the returned rail issue is applied, no extra getIssue read.
    expect(deps.getIssue).not.toHaveBeenCalled()
  })

  it('removeDependency applies the returned fresh issue and notifies onMutated', async () => {
    const deps = makeDeps(
      makeIssue({
        dependencies: [
          {
            id: 'pm-9',
            title: 'Blocker',
            status: 'open',
            priority: 2,
            issue_type: 'task',
            created_at: '2026-06-01T00:00:00Z',
            updated_at: '2026-06-10T00:00:00Z',
            dependency_type: 'blocks',
          },
        ],
      }),
    )
    const onMutated = vi.fn()
    const { result } = renderHook(() =>
      useIssueEdits(
        makeIssue({
          dependencies: [
            {
              id: 'pm-9',
              title: 'Blocker',
              status: 'open',
              priority: 2,
              issue_type: 'task',
              created_at: '2026-06-01T00:00:00Z',
              updated_at: '2026-06-10T00:00:00Z',
              dependency_type: 'blocks',
            },
          ],
        }),
        deps,
        onMutated,
      ),
    )

    // The edge is gone after remove: the returned rail issue has no dependencies.
    deps.removeDependency.mockResolvedValue(makeIssue({ dependencies: [] }))
    await act(() => result.current.actions.removeDependency('pm-1', 'pm-9'))

    expect(deps.removeDependency).toHaveBeenCalledWith('pm-1', 'pm-9')
    expect(result.current.issue.dependencies).toEqual([])
    expect(onMutated).toHaveBeenCalledTimes(1)
    expect(deps.getIssue).not.toHaveBeenCalled()
  })

  it('a rejected dependency mutation sets error and leaves the issue unchanged', async () => {
    const issue = makeIssue()
    const deps = makeDeps(issue)
    const onMutated = vi.fn()
    const { result } = renderHook(() => useIssueEdits(issue, deps, onMutated))

    deps.addDependency.mockRejectedValue(
      new Error('bd: adding this dependency would create a cycle'),
    )
    await act(() =>
      result.current.actions.addDependency('pm-1', 'pm-9', 'blocks'),
    )

    expect(result.current.error).toContain('would create a cycle')
    expect(result.current.issue).toEqual(issue)
    expect(result.current.saving).toBe(false)
    expect(onMutated).not.toHaveBeenCalled()
  })

  it('surfaces mutation errors and keeps the loaded issue', async () => {
    const issue = makeIssue()
    const deps = makeDeps(issue)
    const onMutated = vi.fn()
    const { result } = renderHook(() => useIssueEdits(issue, deps, onMutated))

    deps.updateIssue.mockRejectedValue(new Error('bd exploded'))
    await act(() => result.current.actions.setStatus('blocked'))
    expect(result.current.error).toBe('bd exploded')
    expect(result.current.issue).toEqual(issue)
    expect(result.current.saving).toBe(false)
    expect(onMutated).not.toHaveBeenCalled()
  })

  it('clears a prior error when navigating to a new issue', async () => {
    const deps = makeDeps(makeIssue())
    const { result, rerender } = renderHook(
      ({ issue }: { issue: ShowIssue }) => useIssueEdits(issue, deps),
      { initialProps: { issue: makeIssue() } },
    )

    deps.updateIssue.mockRejectedValue(new Error('boom'))
    await act(() => result.current.actions.setStatus('blocked'))
    expect(result.current.error).toBe('boom')

    rerender({ issue: makeIssue({ id: 'pm-2' }) })
    await waitFor(() => expect(result.current.error).toBeNull())
  })

  it('setTitle trims and applies the returned issue', async () => {
    const deps = makeDeps(makeIssue())
    const onMutated = vi.fn()
    const { result } = renderHook(() =>
      useIssueEdits(makeIssue(), deps, onMutated),
    )

    deps.saveTextField.mockResolvedValue({
      ok: true,
      issue: makeIssue({ title: 'Renamed' }),
    })
    await act(() =>
      result.current.actions.setTitle('  Renamed  ', 'Test issue'),
    )

    expect(deps.saveTextField).toHaveBeenCalledWith(
      'pm-1',
      'title',
      'Renamed',
      'Test issue',
    )
    expect(result.current.issue.title).toBe('Renamed')
    expect(onMutated).toHaveBeenCalledTimes(1)
    expect(deps.getIssue).not.toHaveBeenCalled()
  })

  it('setTitle refuses a blank title instead of letting bd reject it', async () => {
    const issue = makeIssue()
    const deps = makeDeps(issue)
    const onMutated = vi.fn()
    const { result } = renderHook(() => useIssueEdits(issue, deps, onMutated))

    await act(() => result.current.actions.setTitle('   ', 'Test issue'))

    // bd itself errors with "title cannot be empty"; catching it here keeps the rail's
    // message ours and spares a pointless round trip.
    expect(deps.saveTextField).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/title/i)
    expect(result.current.issue).toEqual(issue)
    expect(onMutated).not.toHaveBeenCalled()
  })

  it('setDescription passes the markdown source through untouched', async () => {
    const deps = makeDeps(makeIssue())
    const { result } = renderHook(() => useIssueEdits(makeIssue(), deps))

    // Trailing spaces are a markdown hard line break, so the source is never trimmed.
    const source = '## Notes\n\nline one  \nline two\n'
    deps.saveTextField.mockResolvedValue({
      ok: true,
      issue: makeIssue({ description: source }),
    })
    await act(() => result.current.actions.setDescription(source, ''))

    expect(deps.saveTextField).toHaveBeenCalledWith(
      'pm-1',
      'description',
      source,
      '',
    )
    expect(result.current.issue.description).toBe(source)
  })

  it('writes design, acceptance criteria and notes through their own bd fields', async () => {
    const deps = makeDeps(makeIssue())
    const { result } = renderHook(() => useIssueEdits(makeIssue(), deps))

    // One setter per field: bd spells acceptance criteria `--acceptance`, and a single
    // setter taking a field name would let a caller pass one bd has no flag for.
    await act(() => result.current.actions.setDesign('## Shape', ''))
    expect(deps.saveTextField).toHaveBeenCalledWith(
      'pm-1',
      'design',
      '## Shape',
      '',
    )

    await act(() =>
      result.current.actions.setAcceptanceCriteria('- [ ] done', ''),
    )
    expect(deps.saveTextField).toHaveBeenCalledWith(
      'pm-1',
      'acceptance_criteria',
      '- [ ] done',
      '',
    )

    await act(() => result.current.actions.setNotes('a note', 'old note'))
    expect(deps.saveTextField).toHaveBeenCalledWith(
      'pm-1',
      'notes',
      'a note',
      'old note',
    )
  })

  it('setDescription sends an empty string so bd clears the field', async () => {
    const deps = makeDeps(makeIssue({ description: 'old body' }))
    const { result } = renderHook(() =>
      useIssueEdits(makeIssue({ description: 'old body' }), deps),
    )

    // Verified against bd 1.2.2: `bd update <id> --description ""` clears the field.
    // --allow-empty-description only gates the stdin/file read path, so no special casing.
    deps.saveTextField.mockResolvedValue({ ok: true, issue: makeIssue() })
    await act(() => result.current.actions.setDescription('', 'old body'))

    expect(deps.saveTextField).toHaveBeenCalledWith(
      'pm-1',
      'description',
      '',
      'old body',
    )
    expect(result.current.issue.description).toBeUndefined()
  })

  // pm-beads-n88: `saving` disables controls a render too late to stop a second trigger, so two
  // mutations can overlap. Without a guard the LAST-RESOLVING read wins, which is whichever bd
  // call happened to finish last — not the edit the user made last.
  describe('overlapping mutations', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void
      let reject!: (reason: unknown) => void
      const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    it('drops a stale read so the later edit wins, however the calls resolve', async () => {
      const deps = makeDeps(makeIssue())
      const { result } = renderHook(() => useIssueEdits(makeIssue(), deps))

      const first = deferred<ShowIssue>()
      const second = deferred<ShowIssue>()
      deps.updateIssue
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)

      let firstCall: Promise<boolean> | undefined
      let secondCall: Promise<boolean> | undefined
      act(() => {
        firstCall = result.current.actions.setAssignee('ben')
        secondCall = result.current.actions.setPriority(0)
      })

      // The second edit finishes first; the first one lands afterwards with a read taken
      // before it — the stale value the old code would have applied.
      await act(async () => {
        second.resolve(makeIssue({ assignee: 'ben', priority: 0 }))
        await secondCall
        first.resolve(makeIssue({ assignee: 'ben', priority: 2 }))
        await firstCall
      })

      expect(result.current.issue.priority).toBe(0)
      expect(result.current.issue.assignee).toBe('ben')
    })

    it('keeps saving true until the last in-flight mutation settles', async () => {
      const deps = makeDeps(makeIssue())
      const { result } = renderHook(() => useIssueEdits(makeIssue(), deps))

      const first = deferred<ShowIssue>()
      const second = deferred<ShowIssue>()
      deps.updateIssue
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)

      let firstCall: Promise<boolean> | undefined
      let secondCall: Promise<boolean> | undefined
      act(() => {
        firstCall = result.current.actions.setAssignee('ben')
        secondCall = result.current.actions.setPriority(0)
      })
      expect(result.current.saving).toBe(true)

      await act(async () => {
        first.resolve(makeIssue({ assignee: 'ben' }))
        await firstCall
      })
      // One is still running: the rail must stay disabled.
      expect(result.current.saving).toBe(true)

      await act(async () => {
        second.resolve(makeIssue({ assignee: 'ben', priority: 0 }))
        await secondCall
      })
      expect(result.current.saving).toBe(false)
    })

    it('still reports a failure from the earlier call', async () => {
      const deps = makeDeps(makeIssue())
      const { result } = renderHook(() => useIssueEdits(makeIssue(), deps))

      const first = deferred<ShowIssue>()
      const second = deferred<ShowIssue>()
      deps.updateIssue
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise)

      let firstCall: Promise<boolean> | undefined
      let secondCall: Promise<boolean> | undefined
      act(() => {
        firstCall = result.current.actions.setAssignee('ben')
        secondCall = result.current.actions.setPriority(0)
      })

      await act(async () => {
        second.resolve(makeIssue({ priority: 0 }))
        await secondCall
        first.reject(new Error('bd exploded'))
        await firstCall
      })

      // The write that failed is not silently swallowed just because a later one succeeded.
      expect(result.current.error).toBe('bd exploded')
      expect(result.current.issue.priority).toBe(0)
    })
  })

  // pm-beads-6d5: a whole-field text save replaces the field, so a save built on text an agent
  // has since rewritten erases that rewrite. Every text setter carries the baseline it opened
  // with, and a refusal has to leave the reader better off than a dead end.
  describe('concurrent-edit guard', () => {
    it('refuses the save and hands the editor what the field says now', async () => {
      const deps = makeDeps(makeIssue({ description: 'what I opened with' }))
      const onMutated = vi.fn()
      const { result } = renderHook(() =>
        useIssueEdits(
          makeIssue({ description: 'what I opened with' }),
          deps,
          onMutated,
        ),
      )

      deps.saveTextField.mockResolvedValue({
        ok: false,
        issue: makeIssue({ description: 'the agent rewrote this' }),
        conflict: { field: 'description', current: 'the agent rewrote this' },
      })
      const outcome = await act(() =>
        result.current.actions.setDescription('my draft', 'what I opened with'),
      )

      // Refused, and the refusal carries the incoming text so the editor can show it.
      expect(outcome).toEqual({
        saved: false,
        storedText: 'the agent rewrote this',
      })
      // The rail shows the text that is actually stored, so the reader can see what changed.
      expect(result.current.issue.description).toBe('the agent rewrote this')
      // Nothing was written, so nothing downstream is stale, and this is not a bd failure.
      expect(onMutated).not.toHaveBeenCalled()
      expect(result.current.error).toBeNull()
    })

    it('lands the write once the baseline matches again', async () => {
      const deps = makeDeps(makeIssue())
      const onMutated = vi.fn()
      const { result } = renderHook(() =>
        useIssueEdits(makeIssue(), deps, onMutated),
      )

      deps.saveTextField.mockResolvedValue({
        ok: false,
        issue: makeIssue({ description: 'theirs' }),
        conflict: { field: 'description', current: 'theirs' },
      })
      await act(() => result.current.actions.setDescription('mine', 'stale'))
      expect(onMutated).not.toHaveBeenCalled()

      // Overwriting deliberately re-sends the draft against the text now on screen.
      deps.saveTextField.mockResolvedValue({
        ok: true,
        issue: makeIssue({ description: 'mine' }),
      })
      const outcome = await act(() =>
        result.current.actions.setDescription('mine', 'theirs'),
      )

      expect(outcome).toEqual({ saved: true })
      expect(result.current.issue.description).toBe('mine')
      expect(onMutated).toHaveBeenCalledTimes(1)
    })

    it('reports a bd failure as a refusal with no incoming text', async () => {
      const deps = makeDeps(makeIssue())
      const { result } = renderHook(() => useIssueEdits(makeIssue(), deps))

      deps.saveTextField.mockRejectedValue(new Error('bd exploded'))
      const outcome = await act(() =>
        result.current.actions.setNotes('mine', 'stale'),
      )

      // Nothing to reconcile with: this is the rail's error line, not a conflict notice.
      expect(outcome).toEqual({ saved: false })
      expect(result.current.error).toBe('bd exploded')
    })
  })
})
