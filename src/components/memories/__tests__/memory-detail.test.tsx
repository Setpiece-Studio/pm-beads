// ABOUTME: Component tests for memory detail rendering and delete confirmation.

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryDetail } from '../memory-detail'

function renderInRouter(node: React.ReactNode) {
  const rootRoute = createRootRoute({ component: () => node })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/memories/test'] }),
    scrollRestoration: false,
  })
  // biome-ignore lint/suspicious/noExplicitAny: test router is not the registered app router.
  return render(<RouterProvider router={router as any} />)
}

describe('MemoryDetail', () => {
  afterEach(cleanup)

  it('renders the key and body', async () => {
    renderInRouter(
      <MemoryDetail
        memory={{ key: 'alpha-memory', value: 'alpha memory body' }}
        onDelete={async () => undefined}
      />,
    )

    expect(
      await screen.findByRole('heading', { name: 'alpha-memory' }),
    ).toBeDefined()
    expect(screen.getByText('alpha memory body')).toBeDefined()
  })

  it('confirms before calling onDelete', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    renderInRouter(
      <MemoryDetail
        memory={{ key: 'alpha-memory', value: 'alpha memory body' }}
        onDelete={onDelete}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(
      screen.getByRole('heading', { name: 'Delete memory?' }),
    ).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Delete memory' }))

    await waitFor(() => expect(onDelete).toHaveBeenCalledOnce())
  })
})
