// ABOUTME: Rendering coverage for Gantt progress, dependency warnings, and navigation-only bars.
// ABOUTME: Ensures the chart remains usable with empty projects and has no drag affordances.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import { ProjectsDisplayOptions } from './projects-display-options'
import { ProjectsGantt } from './projects-gantt'
import { buildGantt } from './projects-gantt-model'

afterEach(cleanup)

it('renders leaf counts, warns about conflicting prerequisites, and only selects on click', () => {
  const a: Issue = {
    id: 'a',
    title: 'Alpha',
    owner: 'account@example.com',
    assignee: 'Ben',
    priority: 1,
    status: 'open',
    issue_type: 'epic',
    created_at: '',
    updated_at: '',
  }
  const b = { ...a, id: 'b', title: 'Beta', priority: 2 }
  const onSelect = vi.fn()
  const model = buildGantt(
    [a, b],
    [
      a,
      b,
      {
        ...a,
        id: 'child',
        parent: 'a',
        issue_type: 'task',
        status: 'closed',
      },
    ],
    { a: ['b', 'hidden'] },
  )
  const { container } = render(
    <>
      <ProjectsGantt model={model} onSelect={onSelect} />
      <ProjectsDisplayOptions
        view="gantt"
        grouping="status"
        ordering="priority"
        onChange={vi.fn()}
        gantt={model}
      />
    </>,
  )
  expect(screen.getByText('Ben')).toBeTruthy()
  expect(screen.queryByText(/1 prerequisite conflict/)).toBeNull()
  expect(screen.queryByText(/Width counts/)).toBeNull()
  expect(
    screen.getByText('Beta → Alpha · Sequence conflict', { selector: 'title' }),
  ).toBeTruthy()
  expect(
    screen.getByRole('button', { name: 'Beta: 0/0 subissues complete' }),
  ).toBeTruthy()
  fireEvent.click(
    screen.getByRole('button', { name: 'Alpha: 1/1 subissues complete' }),
  )
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('a')
  expect(container.querySelector('[draggable="true"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Display' }))
  expect(screen.getByText(/1 prerequisite conflict/)).toBeTruthy()
  expect(screen.getByText(/outside the current filters/)).toBeTruthy()
  expect(screen.getByText(/Width counts/)).toBeTruthy()
})
