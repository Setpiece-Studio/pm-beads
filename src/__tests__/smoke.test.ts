// ABOUTME: Smoke test — verifies the test harness runs and the route tree includes our app routes.
// ABOUTME: Real component/integration tests live alongside the features they cover.

import { describe, expect, it } from 'vitest'
import { routeTree } from '../routeTree.gen'

describe('route tree', () => {
  it('includes the top-level app routes', () => {
    const paths = routeTree.children
      ? Object.values(routeTree.children).map(
          (c) => (c as { options: { path?: string } }).options.path,
        )
      : []
    expect(paths).toEqual(
      expect.arrayContaining(['/projects', '/issues', '/memories', '/search']),
    )
  })
})
