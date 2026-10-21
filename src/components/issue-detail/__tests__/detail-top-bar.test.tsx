// ABOUTME: Component tests for the detail top bar — breadcrumb content, the n/N position and
// ABOUTME: its "—" fallback, first/last arrow disabling, and the j/k keyboard shortcuts.

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { SiblingNav } from '../detail-nav'
import { DetailTopBar, type DetailTopBarProps } from '../detail-top-bar'

// The breadcrumb's section crumb is a typed Link, so the bar must render inside a router that
// knows /issues and /projects. A tiny memory tree satisfies it without the app route tree.
function renderTopBar(
  props: Omit<Partial<DetailTopBarProps>, 'onNavigate'> = {},
) {
  const onNavigate = vi.fn()
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <DetailTopBar
        projectName="pm-beads"
        section="issues"
        id="pm-beads-abc"
        title="Top bar: breadcrumbs and n/N navigation"
        nav={null}
        {...props}
        onNavigate={onNavigate}
      />
    ),
  })
  const listRoutes = (['/issues', '/projects'] as const).map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => null,
    }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, ...listRoutes]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    scrollRestoration: false,
  })
  // biome-ignore lint/suspicious/noExplicitAny: test router is not the registered app router.
  render(<RouterProvider router={router as any} />)
  return { onNavigate }
}

const middleOfThree: SiblingNav = {
  index: 2,
  total: 3,
  previousId: 'first',
  nextId: 'last',
}

describe('DetailTopBar', () => {
  // Mounting a router with real child routes makes it scroll to top, which jsdom answers with a
  // "Not implemented" console error. Stub it so the run's output stays clean.
  beforeAll(() => vi.stubGlobal('scrollTo', vi.fn()))
  afterAll(() => vi.unstubAllGlobals())
  afterEach(cleanup)

  it('renders the project › section › title id breadcrumb with both affordances', async () => {
    renderTopBar()
    expect(await screen.findByText('pm-beads')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Issues' })).toBeDefined()
    expect(screen.getByText('pm-beads-abc')).toBeDefined()
    expect(
      screen.getByText('Top bar: breadcrumbs and n/N navigation'),
    ).toBeDefined()
    // The last crumb is the title; the id trails it as secondary text.
    expect(
      screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent,
    ).toMatch(/Top bar: breadcrumbs and n\/N navigation.*pm-beads-abc/)
    expect(
      screen.getByRole('button', { name: 'Star this issue' }),
    ).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'More issue actions' }),
    ).toBeDefined()
  })

  it('names the projects section and its nouns on the project detail', async () => {
    renderTopBar({ section: 'projects', nav: middleOfThree })
    expect(await screen.findByRole('link', { name: 'Projects' })).toBeDefined()
    expect(
      screen.getByRole('button', { name: 'Previous project' }),
    ).toBeDefined()
    expect(screen.getByRole('button', { name: 'Next project' })).toBeDefined()
  })

  it('shows only an em dash and no arrows when the item is not in a list', async () => {
    renderTopBar({ nav: null })
    expect(await screen.findByText('—')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Previous issue' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next issue' })).toBeNull()
  })

  it('renders the 1-based position and navigates from the arrows', async () => {
    const { onNavigate } = renderTopBar({ nav: middleOfThree })
    expect(await screen.findByText('2 / 3')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Previous issue' }))
    expect(onNavigate).toHaveBeenCalledWith('first')
    fireEvent.click(screen.getByRole('button', { name: 'Next issue' }))
    expect(onNavigate).toHaveBeenCalledWith('last')
  })

  it('disables the arrow that would run off either end of the list', async () => {
    renderTopBar({ nav: { index: 1, total: 3, nextId: 'second' } })
    const previous = await screen.findByRole('button', {
      name: 'Previous issue',
    })
    expect((previous as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Next issue' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('walks the list with j and k, but not while typing in a field', async () => {
    const { onNavigate } = renderTopBar({ nav: middleOfThree })
    await screen.findByText('2 / 3')

    fireEvent.keyDown(window, { key: 'j' })
    expect(onNavigate).toHaveBeenLastCalledWith('last')
    fireEvent.keyDown(window, { key: 'k' })
    expect(onNavigate).toHaveBeenLastCalledWith('first')

    onNavigate.mockClear()
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'j' })
    expect(onNavigate).not.toHaveBeenCalled()
    input.remove()
  })
})
