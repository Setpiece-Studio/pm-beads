// ABOUTME: Rendering + interaction tests for the sub-issues section — header progress, row order
// ABOUTME: and links, expand/collapse persistence, and the inline composer's create round-trip.

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { ShowIssue } from '@/lib/beads/types'
import type { SubIssue } from '../sub-issues-model'
import { SubIssuesSection } from '../sub-issues-section'
import type { IssueEditDeps } from '../use-issue-edits'

// jsdom implements neither scrollTo (router) nor scrollIntoView/ResizeObserver (Radix select +
// popover); stub all three so the section's controls can be driven without a crash.
beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(cleanup)

function child(overrides: Partial<SubIssue> & { id: string }): SubIssue {
  return {
    title: `Child ${overrides.id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...overrides,
  }
}

function createdIssue(id: string, title: string): ShowIssue {
  return {
    id,
    title,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
  }
}

function renderSection(
  overrides: {
    childIssues?: SubIssue[]
    createSubIssue?: IssueEditDeps['createSubIssue']
    onCreated?: () => void
    project?: string
  } = {},
) {
  const createSubIssue =
    overrides.createSubIssue ??
    vi.fn().mockResolvedValue(createdIssue('pm-new', 'New child'))
  const rootRoute = createRootRoute()
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <SubIssuesSection
        parentId="pm-1"
        childIssues={overrides.childIssues ?? []}
        search={{ project: overrides.project }}
        createSubIssue={createSubIssue}
        onCreated={overrides.onCreated}
      />
    ),
  })
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/issues/$issueId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, detailRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    // jsdom has no scrollTo; disabling restoration keeps test output pristine.
    scrollRestoration: false,
  })
  // biome-ignore lint/suspicious/noExplicitAny: test router is not the registered app router.
  const result = render(<RouterProvider router={router as any} />)
  return { ...result, createSubIssue }
}

// The section's rows are the only links in the tree, in render order.
function rowIds(): string[] {
  return [...document.querySelectorAll('a[href^="/issues/"]')].map(
    (a) => a.getAttribute('href')?.split('?')[0].replace('/issues/', '') ?? '',
  )
}

describe('SubIssuesSection', () => {
  it('renders the header with a closed/total progress fraction', async () => {
    renderSection({
      childIssues: [
        child({ id: 'pm-2', status: 'closed' }),
        child({ id: 'pm-3' }),
      ],
    })
    await waitFor(() => expect(screen.getByText('Sub-issues')).toBeDefined())
    expect(screen.getByText('1/2')).toBeDefined()
  })

  it('orders rows open-before-closed, then priority, then id', async () => {
    renderSection({
      childIssues: [
        child({ id: 'pm-9', status: 'closed', priority: 0 }),
        child({ id: 'pm-5', priority: 3 }),
        child({ id: 'pm-4', priority: 1 }),
      ],
    })
    await waitFor(() => expect(rowIds()).toHaveLength(3))
    expect(rowIds()).toEqual(['pm-4', 'pm-5', 'pm-9'])
  })

  it('links each row to the child detail, carrying the project', async () => {
    renderSection({
      childIssues: [child({ id: 'pm-2' })],
      project: '/tmp/proj',
    })
    await waitFor(() => expect(screen.getByText('Child pm-2')).toBeDefined())
    const href = screen
      .getByText('Child pm-2')
      .closest('a')
      ?.getAttribute('href')
    expect(href).toContain('/issues/pm-2')
    expect(href).toContain('project=')
  })

  it('shows the assignee avatar and an unassigned placeholder', async () => {
    renderSection({
      childIssues: [
        child({ id: 'pm-2', assignee: 'Ben Harper' }),
        child({ id: 'pm-3' }),
      ],
    })
    await waitFor(() => expect(screen.getByText('Child pm-2')).toBeDefined())
    expect(screen.getByLabelText('Assigned to Ben Harper').textContent).toBe(
      'BH',
    )
    expect(screen.getByLabelText('Unassigned')).toBeDefined()
  })

  it('collapses and expands the list, remembering the choice for the session', async () => {
    const { unmount } = renderSection({ childIssues: [child({ id: 'pm-2' })] })
    await waitFor(() => expect(screen.getByText('Child pm-2')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sub-issues' }))
    expect(screen.queryByText('Child pm-2')).toBeNull()
    // The header stays put so the section can be reopened.
    expect(
      screen.getByRole('button', { name: 'Expand sub-issues' }),
    ).toBeDefined()

    // A fresh mount (navigating to another issue) reads the remembered collapse.
    unmount()
    renderSection({ childIssues: [child({ id: 'pm-2' })] })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Expand sub-issues' }),
      ).toBeDefined(),
    )
    expect(screen.queryByText('Child pm-2')).toBeNull()
  })

  it('hides completed rows through the display options, keeping the ring truthful', async () => {
    renderSection({
      childIssues: [
        child({ id: 'pm-2', status: 'closed' }),
        child({ id: 'pm-3' }),
      ],
    })
    await waitFor(() => expect(screen.getByText('Child pm-2')).toBeDefined())

    fireEvent.click(
      screen.getByRole('button', { name: 'Sub-issue display options' }),
    )
    fireEvent.click(
      await screen.findByRole('button', { name: /Show completed/ }),
    )

    await waitFor(() => expect(screen.queryByText('Child pm-2')).toBeNull())
    expect(screen.getByText('Child pm-3')).toBeDefined()
    // The header still counts every child, filtered out of the list or not.
    expect(screen.getByText('1/2')).toBeDefined()
  })

  it('creates a sub-issue from the composer and renders it immediately', async () => {
    const onCreated = vi.fn()
    const createSubIssue = vi
      .fn()
      .mockResolvedValue(createdIssue('pm-7', 'Wire the flux capacitor'))
    renderSection({ createSubIssue, onCreated })
    await waitFor(() => expect(screen.getByText('Sub-issues')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Add sub-issues' }))
    fireEvent.change(screen.getByLabelText('Issue title'), {
      target: { value: '  Wire the flux capacitor  ' },
    })
    fireEvent.change(screen.getByLabelText('Add description'), {
      target: { value: 'It needs 1.21 gigawatts.' },
    })
    fireEvent.change(screen.getByLabelText('Sub-issue assignee'), {
      target: { value: 'marty' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(createSubIssue).toHaveBeenCalledWith({
        parentId: 'pm-1',
        title: 'Wire the flux capacitor',
        type: 'task',
        priority: 2,
        description: 'It needs 1.21 gigawatts.',
        assignee: 'marty',
        labels: undefined,
      }),
    )
    // The returned child renders without waiting on a loader round-trip, and the host is
    // told to mark the list routes stale.
    await waitFor(() =>
      expect(screen.getByText('Wire the flux capacitor')).toBeDefined(),
    )
    expect(screen.getByText('0/1')).toBeDefined()
    expect(onCreated).toHaveBeenCalled()
    // The composer closes on success.
    expect(screen.queryByLabelText('Issue title')).toBeNull()
  })

  it('keeps the composer open and reports the message when the create fails', async () => {
    const createSubIssue = vi.fn().mockRejectedValue(new Error('bd said no'))
    renderSection({ createSubIssue })
    await waitFor(() => expect(screen.getByText('Sub-issues')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Add sub-issue' }))
    fireEvent.change(screen.getByLabelText('Issue title'), {
      target: { value: 'Doomed' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('bd said no'),
    )
    expect(screen.getByLabelText('Issue title')).toBeDefined()
  })

  it('will not create an issue without a title', async () => {
    const { createSubIssue } = renderSection()
    await waitFor(() => expect(screen.getByText('Sub-issues')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Add sub-issues' }))
    const create = screen.getByRole('button', {
      name: 'Create',
    }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.click(create)
    expect(createSubIssue).not.toHaveBeenCalled()
  })

  it('discards the draft on Cancel', async () => {
    const { createSubIssue } = renderSection()
    await waitFor(() => expect(screen.getByText('Sub-issues')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Add sub-issues' }))
    fireEvent.change(screen.getByLabelText('Issue title'), {
      target: { value: 'Never mind' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('Issue title')).toBeNull()
    expect(createSubIssue).not.toHaveBeenCalled()
  })

  it('sends label chips committed in the composer', async () => {
    const createSubIssue = vi
      .fn()
      .mockResolvedValue(createdIssue('pm-8', 'Labeled child'))
    renderSection({ createSubIssue })
    await waitFor(() => expect(screen.getByText('Sub-issues')).toBeDefined())

    fireEvent.click(screen.getByRole('button', { name: 'Add sub-issues' }))
    fireEvent.change(screen.getByLabelText('Issue title'), {
      target: { value: 'Labeled child' },
    })
    const labelInput = screen.getByLabelText('Add sub-issue label')
    fireEvent.change(labelInput, { target: { value: 'frontend' } })
    fireEvent.keyDown(labelInput, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() =>
      expect(createSubIssue).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ['frontend'] }),
      ),
    )
  })
})
