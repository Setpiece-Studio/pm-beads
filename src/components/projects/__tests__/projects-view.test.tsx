// ABOUTME: Rendering tests for ProjectsView — status group headers, epic rows with progress,
// ABOUTME: chevron expand with lazy child sub-rows, row click selection, and the filter bar.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ActiveFilter } from '@/components/filters/filters'
import type { EpicStatus, Issue } from '@/lib/beads/types'
import { ProjectsView, type ProjectsViewProps } from '../projects-view'

// Radix popover positioning needs ResizeObserver; cmdk needs scrollIntoView. Neither
// exists in jsdom.
beforeAll(() => {
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

function makeEpic(
  id: string,
  status: string,
  counts: { total: number; closed: number },
): EpicStatus {
  return {
    epic: {
      id,
      title: `Epic ${id}`,
      status,
      priority: 1,
      issue_type: 'epic',
      created_at: '2026-06-01T00:00:00Z',
      updated_at: '2026-06-10T00:00:00Z',
    },
    total_children: counts.total,
    closed_children: counts.closed,
    eligible_for_close: false,
  }
}

function makeChild(id: string): Issue {
  return {
    id,
    title: `Child ${id}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    labels: ['web'],
  }
}

const noop = () => {}

function renderView(
  props: Partial<ProjectsViewProps> & { epics: EpicStatus[] },
) {
  render(
    <ProjectsView
      filters={[]}
      view="list"
      grouping="status"
      ordering="priority"
      edges={{}}
      treeEdges={{}}
      valueOptions={{}}
      onFiltersChange={noop}
      onViewOptionsChange={noop}
      fetchChildren={vi.fn().mockResolvedValue([])}
      onSelectEpic={noop}
      onSelectIssue={noop}
      {...props}
    />,
  )
}

describe('ProjectsView', () => {
  afterEach(cleanup)

  it('renders status group headers with epic counts', () => {
    renderView({
      epics: [
        makeEpic('e1', 'in_progress', { total: 4, closed: 1 }),
        makeEpic('e2', 'open', { total: 0, closed: 0 }),
      ],
    })
    expect(screen.getByText('In Progress')).toBeDefined()
    expect(screen.getByText('Open')).toBeDefined()
    expect(screen.getByText('Epic e1')).toBeDefined()
    expect(screen.getByText('1/4')).toBeDefined()
  })

  it('expands an epic via its chevron, fetching children once', async () => {
    const fetcher = vi.fn().mockResolvedValue([makeChild('c1')])
    renderView({
      epics: [makeEpic('e1', 'open', { total: 1, closed: 0 })],
      fetchChildren: fetcher,
    })

    expect(screen.queryByText('Child c1')).toBeNull()
    const chevron = screen.getByRole('button', { name: /expand epic e1/i })
    fireEvent.click(chevron)
    await waitFor(() => expect(screen.getByText('Child c1')).toBeDefined())

    // Collapse and re-expand: cached, no second fetch.
    fireEvent.click(chevron)
    expect(screen.queryByText('Child c1')).toBeNull()
    fireEvent.click(chevron)
    await waitFor(() => expect(screen.getByText('Child c1')).toBeDefined())
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('selects the epic on row click and the child on sub-row click', async () => {
    const onSelectEpic = vi.fn()
    const onSelectIssue = vi.fn()
    const fetcher = vi.fn().mockResolvedValue([makeChild('c1')])
    renderView({
      epics: [makeEpic('e1', 'open', { total: 1, closed: 0 })],
      fetchChildren: fetcher,
      onSelectEpic,
      onSelectIssue,
    })

    // Epic row click routes to the project detail; child row click to the issue detail.
    fireEvent.click(screen.getByText('Epic e1'))
    expect(onSelectEpic).toHaveBeenLastCalledWith('e1')
    expect(onSelectIssue).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /expand epic e1/i }))
    await waitFor(() => expect(screen.getByText('Child c1')).toBeDefined())
    fireEvent.click(screen.getByText('Child c1'))
    expect(onSelectIssue).toHaveBeenLastCalledWith('c1')
  })

  it('does not select the epic when only the chevron is clicked', () => {
    const onSelectEpic = vi.fn()
    renderView({
      epics: [makeEpic('e1', 'open', { total: 1, closed: 0 })],
      onSelectEpic,
    })
    fireEvent.click(screen.getByRole('button', { name: /expand epic e1/i }))
    expect(onSelectEpic).not.toHaveBeenCalled()
  })

  it('renders a single bucket without status headers when grouping is none', () => {
    renderView({
      epics: [
        makeEpic('e1', 'in_progress', { total: 4, closed: 1 }),
        makeEpic('e2', 'open', { total: 0, closed: 0 }),
      ],
      grouping: 'none',
    })
    expect(screen.getByText('All projects')).toBeDefined()
    expect(screen.queryByText('In Progress')).toBeNull()
    expect(screen.queryByText('Open')).toBeNull()
  })

  it('reports grouping and ordering changes from the display options', () => {
    const onViewOptionsChange = vi.fn()
    renderView({
      epics: [makeEpic('e1', 'open', { total: 1, closed: 0 })],
      onViewOptionsChange,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Display' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Ordering' }))
    fireEvent.click(screen.getByRole('option', { name: 'Blocking order' }))
    expect(onViewOptionsChange).toHaveBeenLastCalledWith({
      ordering: 'blocking',
    })
  })
})

describe('ProjectsView filtering', () => {
  afterEach(cleanup)

  const epics = [
    makeEpic('e1', 'open', { total: 1, closed: 0 }),
    makeEpic('e2', 'closed', { total: 2, closed: 2 }),
  ]

  it('renders the filter bar and adds a filter via the menu', () => {
    const onFiltersChange = vi.fn()
    renderView({
      epics,
      valueOptions: { status: [{ value: 'open', label: 'Open' }] },
      onFiltersChange,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    // Epic property list: no Type, no Project.
    expect(screen.queryByText('Type')).toBeNull()
    expect(screen.queryByText('Project')).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: 'Status' }))
    fireEvent.click(screen.getByRole('option', { name: /Open/ }))
    expect(onFiltersChange).toHaveBeenCalledWith([
      { property: 'status', operator: 'is', values: ['open'] },
    ])
  })

  it('narrows epic rows to those matching the active filters', () => {
    const filters: ActiveFilter[] = [
      { property: 'status', operator: 'is', values: ['open'] },
    ]
    renderView({ epics, filters })
    expect(screen.getByText('Epic e1')).toBeDefined()
    expect(screen.queryByText('Epic e2')).toBeNull()
  })

  it('shows a filtered empty state when no epic matches', () => {
    const filters: ActiveFilter[] = [
      { property: 'status', operator: 'is', values: ['blocked'] },
    ]
    renderView({ epics, filters })
    expect(screen.getByText('No epics match the current filters')).toBeDefined()
    expect(screen.queryByText('No epics yet')).toBeNull()
  })

  it('shows the no-epics empty state when the project has no epics', () => {
    renderView({ epics: [] })
    expect(screen.getByText('No epics yet')).toBeDefined()
  })
})
