// ABOUTME: Component tests for the sidebar project picker — opening the command dialog,
// ABOUTME: listing discovered projects, marking the current one, and selection callbacks.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { type PickerProject, ProjectPicker } from './project-picker'

afterEach(cleanup)

// cmdk scrolls the selected item into view and Radix Dialog measures layout;
// neither scrollIntoView nor ResizeObserver exist in jsdom.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

const projects: PickerProject[] = [
  {
    path: '/home/zo/dev/sample-project',
    name: 'sample-project',
    isDefault: true,
  },
  { path: '/home/zo/dev/pm-beads', name: 'pm-beads', isDefault: false },
]

function renderPicker({
  currentPath = null as string | null,
  onSelect = vi.fn(),
  discover = vi.fn().mockResolvedValue(projects),
} = {}) {
  render(
    <ProjectPicker
      currentName={currentPath ? 'pm-beads' : 'sample-project'}
      currentPath={currentPath}
      discoverProjects={discover}
      onSelect={onSelect}
    />,
  )
  return { onSelect, discover }
}

describe('ProjectPicker', () => {
  it('renders the current project name as the trigger button', () => {
    renderPicker()
    expect(screen.getByRole('button', { name: /sample-project/ })).toBeTruthy()
  })

  it('opens the dialog and lists discovered projects with paths', async () => {
    const { discover } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /sample-project/ }))
    expect(discover).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('pm-beads')).toBeTruthy()
    expect(screen.getByText('/home/zo/dev/pm-beads')).toBeTruthy()
    expect(screen.getByText('/home/zo/dev/sample-project')).toBeTruthy()
  })

  it('does not call discoverProjects until opened', () => {
    const { discover } = renderPicker()
    expect(discover).not.toHaveBeenCalled()
  })

  it('marks the default project as current when no path is selected', async () => {
    renderPicker({ currentPath: null })
    fireEvent.click(screen.getByRole('button', { name: /sample-project/ }))
    const current = (
      await screen.findByText('sample-project (default)')
    ).closest('[cmdk-item]')
    expect(current?.getAttribute('data-current')).toBe('true')
  })

  it('marks an explicitly selected project as current', async () => {
    renderPicker({ currentPath: '/home/zo/dev/pm-beads' })
    fireEvent.click(screen.getByRole('button', { name: /pm-beads/ }))
    const current = (await screen.findByText('/home/zo/dev/pm-beads')).closest(
      '[cmdk-item]',
    )
    expect(current?.getAttribute('data-current')).toBe('true')
  })

  it('selecting a non-default project calls onSelect with its path', async () => {
    const { onSelect } = renderPicker()
    fireEvent.click(screen.getByRole('button', { name: /sample-project/ }))
    fireEvent.click(await screen.findByText('pm-beads'))
    expect(onSelect).toHaveBeenCalledWith('/home/zo/dev/pm-beads')
  })

  it('selecting the default project calls onSelect with null', async () => {
    const { onSelect } = renderPicker({
      currentPath: '/home/zo/dev/pm-beads',
    })
    fireEvent.click(screen.getByRole('button', { name: /pm-beads/ }))
    fireEvent.click(await screen.findByText('sample-project (default)'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('shows an error message when discovery fails', async () => {
    renderPicker({
      discover: vi.fn().mockRejectedValue(new Error('scan failed')),
    })
    fireEvent.click(screen.getByRole('button', { name: /sample-project/ }))
    expect(await screen.findByText(/could not discover projects/i)).toBeTruthy()
  })
})
