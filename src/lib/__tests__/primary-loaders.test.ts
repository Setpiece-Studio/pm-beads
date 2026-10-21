// ABOUTME: Detail/root loaders must finish without waiting on any secondary queries.
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_STATUS_PIPELINE } from '@/lib/beads/status-model'
import type { ShowIssue } from '@/lib/beads/types'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator() {
      return this
    },
    handler(fn: unknown) {
      return fn
    },
  }),
}))
vi.mock('@/lib/beads/server-fns', async (original) => {
  const exports = await original<typeof import('@/lib/beads/server-fns')>()
  return Object.fromEntries(Object.keys(exports).map((key) => [key, vi.fn()]))
})

import * as reads from '@/lib/beads/server-fns'
import { Route as Root } from '../../routes/__root'
import { Route as Issues } from '../../routes/issues'
import { Route as IssueDetail } from '../../routes/issues_.$issueId'
import { Route as ProjectDetail } from '../../routes/projects_.$projectId'

const issue = {
  id: 'pm-1',
  title: 'Primary content',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} satisfies ShowIssue
const context = {
  params: { issueId: issue.id, projectId: issue.id },
  deps: { project: '/repo' },
}
function run(route: { options: { loader?: unknown } }) {
  return (route.options.loader as (context: unknown) => Promise<unknown>)(
    context,
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  // These will never settle: the primary loader must not await them.
  for (const read of [
    reads.projectShellStatusFn,
    reads.readPersonasFn,
    reads.readStatusPipelineFn,
    reads.listIssuesFn,
    reads.listEpicsFn,
    reads.listViewsFn,
  ]) {
    vi.mocked(read).mockImplementation(() => new Promise<never>(() => {}))
  }
})
it('root loads identity and access checks without waiting for the badge or configuration', async () => {
  vi.mocked(reads.defaultProjectFn).mockResolvedValue({
    name: 'Repo',
    path: '/repo',
  })
  vi.mocked(reads.currentUserFn).mockResolvedValue({ key: 'ben', aliases: [] })
  vi.mocked(reads.projectAccessStatusFn).mockResolvedValue({
    projectError: null,
  })
  expect(await run(Root)).toMatchObject({
    projectError: null,
    currentUser: { key: 'ben' },
  })
  expect(reads.projectShellStatusFn).not.toHaveBeenCalled()
  expect(reads.readStatusPipelineFn).not.toHaveBeenCalled()
  expect(reads.readPersonasFn).not.toHaveBeenCalled()
})
it('issue and project details await only their primary bead', async () => {
  vi.mocked(reads.getIssueFn)
    .mockResolvedValueOnce(issue)
    .mockResolvedValueOnce({ ...issue, issue_type: 'epic' })
  expect(await run(IssueDetail)).toEqual({ issue })
  expect(await run(ProjectDetail)).toEqual({
    issue: { ...issue, issue_type: 'epic' },
  })
  expect(reads.listIssuesFn).not.toHaveBeenCalled()
  expect(reads.listEpicsFn).not.toHaveBeenCalled()
  expect(reads.readStatusPipelineFn).not.toHaveBeenCalled()
})
it('the issues list gets epic names from its own snapshot and defers saved views', async () => {
  vi.mocked(reads.listIssuesFn).mockResolvedValue([
    issue,
    { ...issue, id: 'pm-epic', issue_type: 'epic', title: 'Epic' },
  ])
  vi.mocked(reads.readStatusPipelineFn).mockResolvedValue(
    DEFAULT_STATUS_PIPELINE,
  )
  expect(await run(Issues)).toMatchObject({ epicNames: { 'pm-epic': 'Epic' } })
  expect(reads.listEpicsFn).not.toHaveBeenCalled()
  expect(reads.listViewsFn).not.toHaveBeenCalled()
})
