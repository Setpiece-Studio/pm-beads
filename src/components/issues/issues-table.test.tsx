// ABOUTME: Component tests for IssuesTable — group headers with counts, collapse toggling,
// ABOUTME: and row clicks reporting the clicked issue id.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import type { ViewOptions } from './grouping'
import { IssuesTable } from './issues-table'

afterEach(cleanup)

let seq = 0
function issue(overrides: Partial<Issue> = {}): Issue {
  seq += 1
  return {
    id: `t-${seq}`,
    title: `Issue number ${seq}`,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

const defaultOptions: ViewOptions = {
  grouping: 'status',
  ordering: 'priority',
  filters: [],
}

describe('IssuesTable', () => {
  it('renders group headers with counts and issue rows beneath them', () => {
    const issues = [
      issue({ status: 'in_progress' }),
      issue({ status: 'open' }),
      issue({ status: 'open' }),
    ]
    render(
      <IssuesTable
        issues={issues}
        epicNames={{}}
        options={defaultOptions}
        onRowClick={() => {}}
      />,
    )
    expect(screen.getByText('In Progress')).toBeTruthy()
    expect(screen.getByText('Open')).toBeTruthy()
    const openHeader = screen.getByRole('button', { name: /Open/ })
    expect(openHeader.textContent).toContain('2')
    expect(screen.getByText(issues[0].title)).toBeTruthy()
  })

  it('collapses and expands a group when its header is clicked', () => {
    const inProgress = issue({ status: 'in_progress' })
    const open = issue({ status: 'open' })
    render(
      <IssuesTable
        issues={[inProgress, open]}
        epicNames={{}}
        options={defaultOptions}
        onRowClick={() => {}}
      />,
    )
    const header = screen.getByRole('button', { name: /In Progress/ })
    fireEvent.click(header)
    expect(screen.queryByText(inProgress.title)).toBeNull()
    expect(screen.getByText(open.title)).toBeTruthy()
    fireEvent.click(header)
    expect(screen.getByText(inProgress.title)).toBeTruthy()
  })

  it('reports the issue id when a row is clicked', () => {
    const target = issue()
    const onRowClick = vi.fn()
    render(
      <IssuesTable
        issues={[target]}
        epicNames={{}}
        options={defaultOptions}
        onRowClick={onRowClick}
      />,
    )
    fireEvent.click(screen.getByText(target.title))
    expect(onRowClick).toHaveBeenCalledWith(target.id)
  })

  it('shows the epic name on rows and an empty state when nothing matches', () => {
    const child = issue({ parent: 'e-1' })
    const { unmount } = render(
      <IssuesTable
        issues={[child]}
        epicNames={{ 'e-1': 'Big Epic' }}
        options={defaultOptions}
        onRowClick={() => {}}
      />,
    )
    expect(screen.getByText('Big Epic')).toBeTruthy()
    unmount()
    render(
      <IssuesTable
        issues={[]}
        epicNames={{}}
        options={defaultOptions}
        onRowClick={() => {}}
      />,
    )
    expect(screen.getByText(/No issues/)).toBeTruthy()
  })

  it('hides columns whose display property is toggled off', () => {
    const target = issue({ labels: ['ui'] })
    const { unmount } = render(
      <IssuesTable
        issues={[target]}
        epicNames={{}}
        options={defaultOptions}
        displayProperties={new Set(['id', 'labels'])}
        onRowClick={() => {}}
      />,
    )
    expect(screen.getByText(target.id)).toBeTruthy()
    expect(screen.getByText('ui')).toBeTruthy()
    unmount()
    render(
      <IssuesTable
        issues={[target]}
        epicNames={{}}
        options={defaultOptions}
        displayProperties={new Set()}
        onRowClick={() => {}}
      />,
    )
    // Title is always visible; everything else is hidden.
    expect(screen.getByText(target.title)).toBeTruthy()
    expect(screen.queryByText(target.id)).toBeNull()
    expect(screen.queryByText('ui')).toBeNull()
  })

  it('marks a row whose blocker is open and not one whose blocker is closed', () => {
    const openBlocker = issue({ id: 'open-blk', status: 'open' })
    const closedBlocker = issue({ id: 'closed-blk', status: 'closed' })
    const blocked = issue({
      id: 'blocked-row',
      dependencies: [
        { issue_id: 'blocked-row', depends_on_id: 'open-blk', type: 'blocks' },
      ],
    })
    const resolved = issue({
      id: 'resolved-row',
      dependencies: [
        {
          issue_id: 'resolved-row',
          depends_on_id: 'closed-blk',
          type: 'blocks',
        },
      ],
    })
    render(
      <IssuesTable
        issues={[openBlocker, closedBlocker, blocked, resolved]}
        epicNames={{}}
        options={defaultOptions}
        onRowClick={() => {}}
      />,
    )
    // Exactly one marker: the row whose blocker is still open.
    const markers = screen.getAllByLabelText('Has an unresolved blocker')
    expect(markers).toHaveLength(1)
  })

  it('does not mark a row solely for having the literal blocked status', () => {
    // Literal `blocked` status but no unresolved blocks edge → no edge-derived marker, only the
    // status icon. The Ban icon and the dot must not be conflated.
    const literalBlocked = issue({ id: 'lit', status: 'blocked' })
    render(
      <IssuesTable
        issues={[literalBlocked]}
        epicNames={{}}
        options={defaultOptions}
        onRowClick={() => {}}
      />,
    )
    expect(screen.queryByLabelText('Has an unresolved blocker')).toBeNull()
  })

  it('pins every column but the title so the title absorbs the leftover width', () => {
    const { container } = render(
      <IssuesTable
        issues={[issue({ labels: ['ui'], parent: 'e-1' })]}
        epicNames={{ 'e-1': 'Big Epic' }}
        options={defaultOptions}
        onRowClick={() => {}}
      />,
    )
    // Auto layout let the metadata columns claim their intrinsic width and starved the
    // title; fixed layout plus a <col> per column makes the title the only elastic track.
    expect(container.querySelector('table')?.className).toContain('table-fixed')
    const cols = [...container.querySelectorAll('colgroup col')]
    const columnIds = [...container.querySelectorAll('td[data-column]')].map(
      (cell) => (cell as HTMLElement).dataset.column,
    )
    expect(cols).toHaveLength(columnIds.length)
    for (const [index, id] of columnIds.entries()) {
      const width = (cols[index] as HTMLTableColElement).style.width
      if (id === 'title') expect(width).toBe('')
      else expect(width).not.toBe('')
    }
  })

  it('collapses a multi-label row into a stack that expands on hover', () => {
    const { container } = render(
      <IssuesTable
        issues={[issue({ labels: ['frontend', 'backend', 'infra', 'docs'] })]}
        epicNames={{}}
        options={defaultOptions}
        onRowClick={() => {}}
      />,
    )
    const stack = container.querySelector('[data-label-stack]') as HTMLElement
    expect(stack).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.queryByText('docs')).toBeNull()
    fireEvent.mouseEnter(stack)
    expect(screen.getByText('docs')).toBeTruthy()
  })

  it('shows created and updated dates when their properties are on', () => {
    const target = issue({
      created_at: '2024-03-05T12:00:00Z',
      updated_at: '2024-04-09T12:00:00Z',
    })
    render(
      <IssuesTable
        issues={[target]}
        epicNames={{}}
        options={defaultOptions}
        displayProperties={new Set(['created', 'updated'])}
        onRowClick={() => {}}
      />,
    )
    expect(screen.getByText(/Mar \d{1,2}, 2024/)).toBeTruthy()
    expect(screen.getByText(/Apr \d{1,2}, 2024/)).toBeTruthy()
  })
})
