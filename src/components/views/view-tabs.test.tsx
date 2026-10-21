// ABOUTME: Component tests for the saved-view tabs row — rendering, active detection via
// ABOUTME: normalized equality, apply/delete callbacks, and the save-popover flow.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SavedView } from './view-params'
import { ViewTabs } from './view-tabs'

afterEach(cleanup)

// Radix popover positioning needs ResizeObserver, which jsdom lacks.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

const views: SavedView[] = [
  {
    id: 'v1',
    name: 'Bug board',
    route: 'issues',
    params: { view: 'board', filter: 'type:is:bug' },
  },
  {
    id: 'v2',
    name: 'By project',
    route: 'issues',
    params: { grouping: 'project' },
  },
  {
    id: 'v3',
    name: 'Urgent epics',
    route: 'projects',
    params: { filter: 'priority:is:1' },
  },
]

function renderTabs(
  overrides: Partial<React.ComponentProps<typeof ViewTabs>> = {},
) {
  const onApply = vi.fn()
  const onSave = vi.fn()
  const onDelete = vi.fn()
  render(
    <ViewTabs
      route="issues"
      views={views}
      currentParams={{}}
      onApply={onApply}
      onSave={onSave}
      onDelete={onDelete}
      {...overrides}
    />,
  )
  return { onApply, onSave, onDelete }
}

describe('ViewTabs', () => {
  it('renders the All tab plus only the current route views', () => {
    renderTabs()
    expect(screen.getByText('All issues')).toBeDefined()
    expect(screen.getByText('Bug board')).toBeDefined()
    expect(screen.getByText('By project')).toBeDefined()
    expect(screen.queryByText('Urgent epics')).toBeNull()
  })

  it('marks the All tab active at the defaults, even explicit ones', () => {
    renderTabs({ currentParams: { grouping: 'status', ordering: 'priority' } })
    expect(screen.getByText('All issues').getAttribute('aria-current')).toBe(
      'page',
    )
    expect(
      screen
        .getByText('Bug board')
        .closest('button')
        ?.getAttribute('aria-current'),
    ).toBeNull()
  })

  it('marks a saved view active when the current params match after normalization', () => {
    renderTabs({
      currentParams: {
        view: 'board',
        filter: 'type:is:bug',
        grouping: 'status',
        issue: 'abc-1',
      },
    })
    expect(
      screen
        .getByText('Bug board')
        .closest('button')
        ?.getAttribute('aria-current'),
    ).toBe('page')
    expect(
      screen.getByText('All issues').getAttribute('aria-current'),
    ).toBeNull()
  })

  it('applies a view on tab click and clears on the All tab', () => {
    const { onApply } = renderTabs()
    fireEvent.click(screen.getByText('Bug board'))
    expect(onApply).toHaveBeenCalledWith({
      view: 'board',
      filter: 'type:is:bug',
    })
    fireEvent.click(screen.getByText('All issues'))
    expect(onApply).toHaveBeenCalledWith({})
  })

  it('deletes a view via the tab x without applying it', () => {
    const { onApply, onDelete } = renderTabs()
    fireEvent.click(screen.getByLabelText('Delete view Bug board'))
    expect(onDelete).toHaveBeenCalledWith('v1')
    expect(onApply).not.toHaveBeenCalled()
  })

  it('saves the current view through the popover form', () => {
    const { onSave } = renderTabs()
    fireEvent.click(screen.getByLabelText('Save current view'))
    const input = screen.getByLabelText('View name')
    fireEvent.change(input, { target: { value: '  My view  ' } })
    fireEvent.submit(screen.getByText('Save view').closest('form') as Element)
    expect(onSave).toHaveBeenCalledWith('My view')
    // Popover closes after saving.
    expect(screen.queryByLabelText('View name')).toBeNull()
  })

  it('does not save an empty name', () => {
    const { onSave } = renderTabs()
    fireEvent.click(screen.getByLabelText('Save current view'))
    const button = screen.getByText('Save view') as HTMLButtonElement
    expect(button.closest('button')?.disabled).toBe(true)
    fireEvent.submit(button.closest('form') as Element)
    expect(onSave).not.toHaveBeenCalled()
  })
})
