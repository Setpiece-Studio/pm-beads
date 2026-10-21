// ABOUTME: A real router must reread after a write even when an older loader is still running.
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { expect, it } from 'vitest'
import { refreshAfterWrite } from './refresh-after-write'

it('does not reuse the result of a route read started before a mutation', async () => {
  let value = 'old'
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  let reads = 0
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/'] }),
    routeTree: createRootRoute({
      loader: async () => {
        const snapshot = value
        if (++reads === 1) {
          started()
          await gate
        }
        return snapshot
      },
    }),
  })
  const initial = router.load()
  await entered
  value = 'new'
  const refreshed = refreshAfterWrite(router)
  release()
  await initial
  await refreshed
  expect(router.state.matches[0].loaderData).toBe('new')
  expect(reads).toBe(2)
})
