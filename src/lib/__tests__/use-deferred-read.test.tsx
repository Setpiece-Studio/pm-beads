// ABOUTME: Secondary reads start after render and cannot leak stale scope/revision results.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { useDeferredRead } from '../use-deferred-read'

afterEach(cleanup)
function pending<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

it('does not start secondary reads during server rendering', () => {
  const load = vi.fn(async () => 3)
  function Page() {
    const read = useDeferredRead('project', load)
    return <div>Primary content {read.value}</div>
  }
  expect(renderToString(<Page />)).toContain('Primary content')
  expect(load).not.toHaveBeenCalled()
})

it('ignores an old project response even if it resolves last', async () => {
  const old = pending<string>()
  const next = pending<string>()
  const firstLoad = () => old.promise
  const nextLoad = () => next.promise
  const { result, rerender } = renderHook(
    ({ scope, load }) => useDeferredRead(scope, load),
    {
      initialProps: { scope: 'first', load: firstLoad },
    },
  )
  rerender({ scope: 'second', load: nextLoad })
  await act(async () => next.resolve('second data'))
  await act(async () => old.resolve('old data'))
  expect(result.current.value).toBe('second data')
})

it('hides settled data when the selected issue or project changes', async () => {
  const later = pending<string>()
  const initial = async () => 'first issue'
  const { result, rerender } = renderHook(
    ({ scope, load }) => useDeferredRead(scope, load),
    {
      initialProps: { scope: 'first', load: initial },
    },
  )
  await waitFor(() => expect(result.current.value).toBe('first issue'))
  rerender({ scope: 'second', load: () => later.promise })
  expect(result.current.value).toBeUndefined()
  expect(result.current.loading).toBe(true)
  await act(async () => later.resolve('second issue'))
})

it('retains same-scope data while refreshing after a mutation', async () => {
  const refresh = pending<number>()
  const load = vi
    .fn()
    .mockResolvedValueOnce(1)
    .mockReturnValueOnce(refresh.promise)
  const { result, rerender } = renderHook(
    ({ revision }) => useDeferredRead('same', load, revision),
    { initialProps: { revision: 1 } },
  )
  await waitFor(() => expect(result.current.value).toBe(1))
  rerender({ revision: 2 })
  expect(result.current.value).toBe(1)
  await act(async () => refresh.resolve(2))
  expect(result.current.value).toBe(2)
})

it('exposes failures and retries without an unhandled rejection', async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(7)
  const { result } = renderHook(() => useDeferredRead('same', load))
  await waitFor(() => expect(result.current.error).toBe('offline'))
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.value).toBe(7))
  expect(result.current.error).toBeUndefined()
})
