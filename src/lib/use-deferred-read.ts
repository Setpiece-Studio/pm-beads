// ABOUTME: Runs secondary reads after mount, retaining same-page data on refresh.
// ABOUTME: Scope changes hide old data immediately; late responses never replace new data.
import { useCallback, useEffect, useState } from 'react'

export function useDeferredRead<T>(
  scope: string,
  load: () => Promise<T>,
  revision?: unknown,
) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    scope: string
    value?: T
    error?: string
    loading: boolean
  }>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision and retry deliberately trigger a fresh read.
  useEffect(() => {
    let active = true
    setState((previous) => ({
      scope,
      value: previous?.scope === scope ? previous.value : undefined,
      loading: true,
    }))
    Promise.resolve()
      .then(load)
      .then(
        (value) => {
          if (active) setState({ scope, value, loading: false })
        },
        (error) => {
          if (active)
            setState((previous) => ({
              scope,
              value: previous?.scope === scope ? previous.value : undefined,
              error: error instanceof Error ? error.message : String(error),
              loading: false,
            }))
        },
      )
    return () => {
      active = false
    }
  }, [scope, load, revision, attempt])
  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return {
    value: state?.scope === scope ? state.value : undefined,
    error: state?.scope === scope ? state.error : undefined,
    loading: state?.scope !== scope || state.loading,
    retry,
  }
}
