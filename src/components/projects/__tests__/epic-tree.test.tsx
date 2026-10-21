// ABOUTME: Rendering tests for EpicTree — nested epic rows, collapse hiding children, the
// ABOUTME: show-tasks reveal filtering to non-epic children, and the cycle-revisit marker.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import { EpicTree } from '../epic-tree'
import type { EpicTreeNode } from '../projects-model'

afterEach(cleanup)

const noop = () => {}

function node(
  id: string,
  children: EpicTreeNode[] = [],
  opts: { cyclic?: boolean } = {},
): EpicTreeNode {
  return {
    epic: {
      epic: {
        id,
        title: `Epic ${id}`,
        status: 'open',
        priority: 1,
        issue_type: 'epic',
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-10T00:00:00Z',
      },
      total_children: 0,
      closed_children: 0,
      eligible_for_close: false,
    },
    children,
    cyclic: opts.cyclic ?? false,
  }
}

const issue = (id: string, type: string, parent = 'root'): Issue => ({
  id,
  title: `Item ${id}`,
  status: 'open',
  priority: 2,
  issue_type: type,
  parent,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-10T00:00:00Z',
})

describe('EpicTree', () => {
  it('renders nested epics and collapsing a parent hides its children', () => {
    render(
      <EpicTree
        nodes={[node('root', [node('child')])]}
        fetchChildren={vi.fn()}
        onSelectEpic={noop}
        onSelectIssue={noop}
      />,
    )
    expect(screen.getByText('Epic root')).toBeTruthy()
    expect(screen.getByText('Epic child')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Collapse Epic root'))
    expect(screen.queryByText('Epic child')).toBeNull()
  })

  it('reveals only direct non-epic children when show-tasks is toggled', async () => {
    const fetchChildren = vi
      .fn()
      .mockResolvedValue([
        issue('sub', 'epic'),
        issue('t1', 'task'),
        issue('nested', 'task', 'sub'),
      ])
    render(
      <EpicTree
        nodes={[node('root')]}
        fetchChildren={fetchChildren}
        onSelectEpic={noop}
        onSelectIssue={noop}
      />,
    )

    fireEvent.click(screen.getByLabelText('Show tasks for Epic root'))
    await waitFor(() => expect(screen.getByText('Item t1')).toBeTruthy())
    expect(fetchChildren).toHaveBeenCalledWith('root')
    // The epic child is excluded — only work items show under show-tasks.
    expect(screen.queryByText('Item sub')).toBeNull()
    expect(screen.queryByText('Item nested')).toBeNull()
  })

  it('marks a cyclic revisit node instead of recursing into it', () => {
    render(
      <EpicTree
        nodes={[node('a', [node('a', [], { cyclic: true })])]}
        fetchChildren={vi.fn()}
        onSelectEpic={noop}
        onSelectIssue={noop}
      />,
    )
    expect(screen.getByText(/\(cycle\)/)).toBeTruthy()
  })

  it('navigates to the epic detail when an epic row is clicked', () => {
    const onSelectEpic = vi.fn()
    render(
      <EpicTree
        nodes={[node('root')]}
        fetchChildren={vi.fn()}
        onSelectEpic={onSelectEpic}
        onSelectIssue={noop}
      />,
    )
    fireEvent.click(screen.getByText('Epic root'))
    expect(onSelectEpic).toHaveBeenCalledWith('root')
  })
})
