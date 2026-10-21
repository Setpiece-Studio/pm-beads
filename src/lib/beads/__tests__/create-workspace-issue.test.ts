// ABOUTME: Creation failures retain identity and skip completed updates on retry.
import { expect, it, vi } from 'vitest'

vi.mock('../mutations', () => ({
  createIssue: vi.fn(async () => ({ id: 'flat-1' })),
  updateIssue: vi.fn(),
  addLabel: vi.fn(),
  addDependency: vi.fn(),
  setPrUrl: vi.fn(),
}))
vi.mock('../queries', () => ({
  getIssue: vi.fn(async () => ({ id: 'flat-1', labels: [], dependencies: [] })),
}))
vi.mock('../pr-remote', () => ({
  resolvePrRef: vi.fn(async () => 'https://github.com/example/repo/pull/1'),
}))

import { createWorkspaceIssue } from '../create-workspace-issue'
import { addDependency, createIssue, updateIssue } from '../mutations'

it('keeps the flat ID and retries only unfinished operations', async () => {
  vi.mocked(addDependency).mockRejectedValueOnce(new Error('temporary failure'))
  const draft = {
    title: 'New issue',
    type: 'custom',
    priority: 2,
    status: 'review',
    parent: 'epic-1',
    design: 'Design',
    notes: 'Notes',
    acceptance_criteria: 'Acceptance',
    assignee: 'agent',
    labels: ['one'],
    dependencies: ['task-1'],
    prLink: '#1',
  }
  const first = await createWorkspaceIssue(draft)
  expect(first).toMatchObject({
    id: 'flat-1',
    complete: false,
    completedSteps: ['fields'],
  })
  expect(updateIssue).toHaveBeenCalledWith(
    'flat-1',
    expect.objectContaining({
      parent: 'epic-1',
      status: 'review',
    }),
    {},
  )
  const second = await createWorkspaceIssue({
    ...draft,
    createdId: first.id,
    completedSteps: first.completedSteps,
  })
  expect(second.complete).toBe(true)
  expect(createIssue).toHaveBeenCalledTimes(1)
  expect(updateIssue).toHaveBeenCalledTimes(1)
  expect(createIssue).toHaveBeenCalledWith(
    expect.objectContaining({
      design: 'Design',
      acceptance_criteria: 'Acceptance',
      labels: ['one'],
      prUrl: 'https://github.com/example/repo/pull/1',
    }),
    {},
  )
})
