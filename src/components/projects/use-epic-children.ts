// ABOUTME: Hook managing per-epic expand/collapse state and lazy fetching of child issues.
// ABOUTME: Children are fetched once on first expand and cached for the component's lifetime.

import { useCallback, useRef, useState } from 'react'
import type { Issue } from '@/lib/beads/types'

export type FetchChildren = (epicId: string) => Promise<Issue[]>

export function useEpicChildren(fetchChildren: FetchChildren) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [childrenById, setChildrenById] = useState<Record<string, Issue[]>>({})
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(new Set())
  const [errorById, setErrorById] = useState<Record<string, string>>({})
  // Tracks epics whose fetch has started, so re-expands never refetch.
  const requested = useRef<Set<string>>(new Set())

  const toggle = useCallback(
    (epicId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(epicId)) next.delete(epicId)
        else next.add(epicId)
        return next
      })
      if (requested.current.has(epicId)) return
      requested.current.add(epicId)
      setLoadingIds((prev) => new Set(prev).add(epicId))
      fetchChildren(epicId)
        .then((issues) => {
          setChildrenById((prev) => ({ ...prev, [epicId]: issues }))
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          setErrorById((prev) => ({ ...prev, [epicId]: message }))
        })
        .finally(() => {
          setLoadingIds((prev) => {
            const next = new Set(prev)
            next.delete(epicId)
            return next
          })
        })
    },
    [fetchChildren],
  )

  return {
    toggle,
    isExpanded: (epicId: string) => expanded.has(epicId),
    isLoading: (epicId: string) => loadingIds.has(epicId),
    children: (epicId: string): Issue[] | undefined => childrenById[epicId],
    error: (epicId: string): string | undefined => errorById[epicId],
  }
}
