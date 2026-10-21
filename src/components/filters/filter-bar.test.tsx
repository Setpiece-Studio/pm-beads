// ABOUTME: Component tests for the filter bar — add-filter menu flow, compound chip
// ABOUTME: rendering, operator flyout, checkbox value toggling, and chip removal.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FilterBar } from './filter-bar'
import {
  type ActiveFilter,
  EPIC_FILTER_PROPERTIES,
  type FilterProperty,
  type FilterValueOption,
  ISSUE_FILTER_PROPERTIES,
  NONE_VALUE,
} from './filters'

afterEach(cleanup)

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

const valueOptions: Record<FilterProperty, FilterValueOption[]> = {
  status: [
    { value: 'in_progress', label: 'In Progress' },
    { value: 'open', label: 'Open' },
    { value: 'closed', label: 'Done' },
  ],
  type: [
    { value: 'task', label: 'task' },
    { value: 'bug', label: 'bug' },
  ],
  priority: [
    { value: '0', label: 'Urgent' },
    { value: '1', label: 'High' },
  ],
  assignee: [
    { value: 'ben', label: 'ben' },
    { value: NONE_VALUE, label: 'No assignee' },
  ],
  label: [
    { value: 'ui', label: 'ui' },
    { value: NONE_VALUE, label: 'No label' },
  ],
  project: [
    { value: 'e-1', label: 'Alpha' },
    { value: NONE_VALUE, label: 'No project' },
  ],
}

function renderBar(
  filters: ActiveFilter[] = [],
  onChange = vi.fn(),
  properties: readonly FilterProperty[] = ISSUE_FILTER_PROPERTIES,
) {
  render(
    <FilterBar
      properties={properties}
      filters={filters}
      valueOptions={valueOptions}
      onChange={onChange}
    />,
  )
  return onChange
}

describe('FilterBar add-filter menu', () => {
  it('shows only the Filter button when no filters are active', () => {
    renderBar()
    expect(screen.getByRole('button', { name: 'Filter' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add filter' })).toBeNull()
    expect(screen.queryByText('Status')).toBeNull()
  })

  it('opens a property menu listing all filterable properties', () => {
    renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    for (const name of [
      'Status',
      'Type',
      'Priority',
      'Assignee',
      'Labels',
      'Project',
    ]) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('drills into a property and adds a filter when a value is checked', () => {
    const onChange = renderBar()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByText('Status'))
    fireEvent.click(screen.getByText('In Progress'))
    expect(onChange).toHaveBeenCalledWith([
      { property: 'status', operator: 'is', values: ['in_progress'] },
    ])
  })

  it('lists only the given properties when a subset is passed', () => {
    renderBar([], vi.fn(), EPIC_FILTER_PROPERTIES)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    for (const name of ['Status', 'Priority', 'Labels', 'Assignee']) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    expect(screen.queryByText('Type')).toBeNull()
    expect(screen.queryByText('Project')).toBeNull()
  })

  it('shows a trailing Add filter button when filters are active', () => {
    renderBar([{ property: 'status', operator: 'is', values: ['open'] }])
    const add = screen.getByRole('button', { name: 'Add filter' })
    fireEvent.click(add)
    expect(screen.getByText('Labels')).toBeTruthy()
  })
})

describe('FilterBar chips', () => {
  it('renders a compound chip with property, operator, and single-value summary', () => {
    renderBar([{ property: 'status', operator: 'is', values: ['open'] }])
    expect(screen.getByText('Status')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Status operator' }).textContent,
    ).toBe('is')
    expect(
      screen.getByRole('button', { name: 'Status values' }).textContent,
    ).toContain('Open')
  })

  it('summarizes multiple values with a count and any-of operator label', () => {
    renderBar([
      {
        property: 'status',
        operator: 'is',
        values: ['open', 'in_progress'],
      },
    ])
    expect(
      screen.getByRole('button', { name: 'Status operator' }).textContent,
    ).toBe('is any of')
    expect(
      screen.getByRole('button', { name: 'Status values' }).textContent,
    ).toContain('2 statuses')
  })

  it('flips the operator from the operator flyout', () => {
    const onChange = renderBar([
      { property: 'status', operator: 'is', values: ['open'] },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Status operator' }))
    fireEvent.click(screen.getByRole('option', { name: 'is not' }))
    expect(onChange).toHaveBeenCalledWith([
      { property: 'status', operator: 'is-not', values: ['open'] },
    ])
  })

  it('toggles a value on from the values flyout', () => {
    const onChange = renderBar([
      { property: 'status', operator: 'is', values: ['open'] },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Status values' }))
    fireEvent.click(screen.getByText('In Progress'))
    expect(onChange).toHaveBeenCalledWith([
      { property: 'status', operator: 'is', values: ['open', 'in_progress'] },
    ])
  })

  it('removes the filter when its last value is unchecked', () => {
    const onChange = renderBar([
      { property: 'status', operator: 'is', values: ['open'] },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Status values' }))
    fireEvent.click(screen.getByRole('option', { name: /Open/ }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('marks checked values in the flyout', () => {
    renderBar([{ property: 'status', operator: 'is', values: ['open'] }])
    fireEvent.click(screen.getByRole('button', { name: 'Status values' }))
    expect(
      screen.getByRole('option', { name: /Open/ }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(
      screen
        .getByRole('option', { name: /In Progress/ })
        .getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('removes the chip via its remove button', () => {
    const onChange = renderBar([
      { property: 'status', operator: 'is', values: ['open'] },
      { property: 'label', operator: 'is-not', values: ['ui'] },
    ])
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Status filter' }),
    )
    expect(onChange).toHaveBeenCalledWith([
      { property: 'label', operator: 'is-not', values: ['ui'] },
    ])
  })

  it('renders one chip per active filter', () => {
    renderBar([
      { property: 'status', operator: 'is', values: ['open'] },
      { property: 'project', operator: 'is', values: ['e-1'] },
    ])
    expect(
      screen.getByRole('button', { name: 'Project values' }).textContent,
    ).toContain('Alpha')
    expect(
      screen.getByRole('button', { name: 'Remove Project filter' }),
    ).toBeTruthy()
  })
})
