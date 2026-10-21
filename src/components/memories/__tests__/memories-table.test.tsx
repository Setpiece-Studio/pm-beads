// ABOUTME: Component tests for the memories list table.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoriesTable } from '../memories-table'

describe('MemoriesTable', () => {
  it('renders an empty state', () => {
    render(<MemoriesTable memories={[]} onRowClick={() => undefined} />)
    expect(screen.getByText('No memories found')).toBeDefined()
  })

  it('renders memory keys and calls onRowClick with the selected key', () => {
    const onRowClick = vi.fn()
    render(
      <MemoriesTable
        memories={[
          { key: 'alpha-memory', value: 'alpha body' },
          { key: 'zebra-memory', value: 'zebra body' },
        ]}
        onRowClick={onRowClick}
      />,
    )

    fireEvent.click(screen.getByText('zebra-memory'))

    expect(screen.getByText('alpha body')).toBeDefined()
    expect(onRowClick).toHaveBeenCalledWith('zebra-memory')
  })
})
