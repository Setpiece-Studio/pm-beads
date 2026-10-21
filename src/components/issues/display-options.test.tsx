// ABOUTME: Component tests for the display-options popover — opening it, toggling display
// ABOUTME: property pills, and emitting grouping/ordering/display patches.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DisplayOptions } from './display-options'
import { DEFAULT_DISPLAY_PROPERTIES, type DisplayProperty } from './grouping'

afterEach(cleanup)

// Radix popover positioning (floating-ui) needs ResizeObserver, absent in jsdom.
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

function renderOpen(
  onChange = vi.fn(),
  displayProperties: ReadonlySet<DisplayProperty> = DEFAULT_DISPLAY_PROPERTIES,
) {
  render(
    <DisplayOptions
      view="list"
      grouping="status"
      ordering="priority"
      displayProperties={displayProperties}
      onChange={onChange}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Display/ }))
  return onChange
}

describe('DisplayOptions', () => {
  it('opens a popover with grouping, ordering, and display property pills', () => {
    renderOpen()
    expect(screen.getByText('Grouping')).toBeTruthy()
    expect(screen.getByText('Ordering')).toBeTruthy()
    expect(screen.getByText('Display properties')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Labels' })).toBeTruthy()
  })

  it('marks default-visible properties as pressed and Created as not pressed', () => {
    renderOpen()
    expect(
      screen
        .getByRole('button', { name: 'Labels' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Created' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('emits a displayProperties patch with the property toggled off', () => {
    const onChange = renderOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Labels' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const patch = onChange.mock.calls[0][0]
    expect(patch.displayProperties.has('labels')).toBe(false)
    expect(patch.displayProperties.has('id')).toBe(true)
  })

  it('emits a displayProperties patch with the property toggled on', () => {
    const onChange = renderOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Created' }))
    const patch = onChange.mock.calls[0][0]
    expect(patch.displayProperties.has('created')).toBe(true)
  })

  it('shows the view toggle with List pressed by default', () => {
    renderOpen()
    expect(
      screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Board' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })

  it('emits a view patch when Board is clicked', () => {
    const onChange = renderOpen()
    fireEvent.click(screen.getByRole('button', { name: 'Board' }))
    expect(onChange).toHaveBeenCalledWith({ view: 'board' })
  })
})
