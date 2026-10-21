// ABOUTME: Component tests for the shared detail chrome — the not-found state's per-noun wording
// ABOUTME: (issue vs project) and the error state, rendered inside a minimal router for BackButton.

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ErrorDetail, NotFoundDetail } from '../detail-chrome'

// BackButton calls useRouter(), so the chrome must render inside a router. A tiny memory router
// with a catch-all index satisfies it without an app route tree.
function renderInRouter(node: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    scrollRestoration: false,
  })
  // biome-ignore lint/suspicious/noExplicitAny: test router is not the registered app router.
  return render(<RouterProvider router={router as any} />)
}

describe('NotFoundDetail', () => {
  afterEach(cleanup)

  it('renders the project-not-found wording for noun="project"', async () => {
    renderInRouter(<NotFoundDetail noun="project" />)
    expect(
      await screen.findByRole('heading', { name: 'Project not found' }),
    ).toBeDefined()
    expect(
      screen.getByText(/This project doesn’t exist in the current workspace\./),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'Back' })).toBeDefined()
  })

  it('renders the issue-not-found wording for noun="issue"', async () => {
    renderInRouter(<NotFoundDetail noun="issue" />)
    expect(
      await screen.findByRole('heading', { name: 'Issue not found' }),
    ).toBeDefined()
    expect(
      screen.getByText(/This issue doesn’t exist in the current project\./),
    ).toBeDefined()
  })
})

describe('ErrorDetail', () => {
  afterEach(cleanup)

  it('shows the per-noun load-failure heading and the error message', async () => {
    renderInRouter(
      <ErrorDetail error={new Error('bd exploded')} noun="project" />,
    )
    expect(
      await screen.findByRole('heading', {
        name: /Couldn’t load this project/,
      }),
    ).toBeDefined()
    expect(screen.getByText('bd exploded')).toBeDefined()
  })
})
