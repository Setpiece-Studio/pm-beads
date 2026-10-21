// ABOUTME: Do not let mutation invalidation reuse a route read started before the write.
import type { AnyRouter } from '@tanstack/react-router'

export async function refreshAfterWrite(
  router: AnyRouter,
  options?: Parameters<AnyRouter['invalidate']>[0],
) {
  // TanStack joins an existing loaderPromise even when a match is invalidated.
  // Let that older read settle first, then request and await the post-write read.
  if (
    router.state.isLoading ||
    router.state.matches.some((match) => match.isFetching)
  )
    await router.load({ sync: true })
  await router.invalidate({ ...options, sync: true })
}
