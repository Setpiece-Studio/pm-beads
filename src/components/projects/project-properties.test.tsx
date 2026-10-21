// ABOUTME: All project metadata toggles round-trip and hide consistently in the shared renderer.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { EpicStatus } from '@/lib/beads/types'
import {
  PROJECT_PROPERTIES,
  ProjectFields,
  ProjectPropertiesContext,
  parseProjectProperties,
  serializeProjectProperties,
} from './project-properties'

afterEach(cleanup)
const epic: EpicStatus = {
  epic: {
    id: 'demo-1',
    title: 'Project title',
    issue_type: 'epic',
    status: 'open',
    priority: 2,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    parent: 'parent-1',
    labels: ['example-label'],
  },
  total_children: 3,
  closed_children: 1,
  eligible_for_close: false,
}
it('preserves every toggle, including empty and default selections', () => {
  for (const property of PROJECT_PROPERTIES)
    expect([
      ...parseProjectProperties(
        serializeProjectProperties(new Set([property])),
      ),
    ]).toEqual([property])
  expect([...parseProjectProperties('')]).toEqual([])
  expect(
    serializeProjectProperties(parseProjectProperties(undefined)),
  ).toBeUndefined()
})
it('keeps title visible when all metadata is hidden', () => {
  render(
    <ProjectPropertiesContext.Provider
      value={{ properties: new Set(), names: {} }}
    >
      <ProjectFields epic={epic} />
    </ProjectPropertiesContext.Provider>,
  )
  expect(screen.getByText('Project title')).toBeDefined()
  expect(screen.queryByText('demo-1')).toBeNull()
  expect(screen.queryByText('example-label')).toBeNull()
})
it('renders labels and parent names when selected', () => {
  render(
    <ProjectPropertiesContext.Provider
      value={{
        properties: new Set(PROJECT_PROPERTIES),
        names: { 'parent-1': 'Parent project' },
      }}
    >
      <ProjectFields epic={epic} />
    </ProjectPropertiesContext.Provider>,
  )
  expect(screen.getByText('example-label')).toBeDefined()
  expect(screen.getByText('Parent project')).toBeDefined()
  expect(screen.getByTitle('Child count').textContent).toBe('3')
})
