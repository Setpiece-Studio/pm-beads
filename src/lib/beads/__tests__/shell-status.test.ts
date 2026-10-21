// ABOUTME: Page navigation counts open-ask beads without loading messages or activity.
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listIssues: vi.fn(),
  readInbox: vi.fn(),
  readActivityInbox: vi.fn(),
  stoppedDoltServerError: vi.fn(),
}))
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
vi.mock('../queries', async (original) => ({
  ...(await original<typeof import('../queries')>()),
  listIssues: mocks.listIssues,
  readInbox: mocks.readInbox,
  readActivityInbox: mocks.readActivityInbox,
}))
vi.mock('../projects', async (original) => ({
  ...(await original<typeof import('../projects')>()),
  bdOptionsFor: (cwd?: string) => ({ cwd }),
}))
vi.mock('../dolt-server', () => ({
  stoppedDoltServerError: mocks.stoppedDoltServerError,
}))

import { projectAccessStatusFn, projectShellStatusFn } from '../server-fns'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.stoppedDoltServerError.mockResolvedValue(null)
})

it('checks project access without reading issues or inbox data', async () => {
  expect(
    await projectAccessStatusFn({ data: { projectDir: '/repo' } }),
  ).toEqual({ projectError: null })
  expect(mocks.listIssues).not.toHaveBeenCalled()
  expect(mocks.readInbox).not.toHaveBeenCalled()
  expect(mocks.readActivityInbox).not.toHaveBeenCalled()
})

it('counts beads once and shares the project issue snapshot without notification scans', async () => {
  const ask = {
    kind: 'decision',
    q: 'Choose?',
    by: 'agent',
    at: '2026-01-01T00:00:00Z',
  }
  mocks.listIssues.mockResolvedValue([
    { status: 'blocked', metadata: { 'ask.one': ask, 'ask.two': ask } },
    { status: 'deferred', metadata: { 'ask.invalid': '{' } },
    { status: 'closed', metadata: { 'ask.one': ask } },
    { status: 'open' },
  ])
  expect(await projectShellStatusFn({ data: { projectDir: '/repo' } })).toEqual(
    { openAsks: 2, projectError: null },
  )
  expect(mocks.listIssues).toHaveBeenCalledExactlyOnceWith(
    { all: true },
    { cwd: '/repo' },
  )
  expect(mocks.readInbox).not.toHaveBeenCalled()
  expect(mocks.readActivityInbox).not.toHaveBeenCalled()
})

it('reports a failed database read while leaving the shell available', async () => {
  mocks.listIssues.mockRejectedValue(new Error('Database unavailable'))
  expect(await projectShellStatusFn({ data: { projectDir: '/repo' } })).toEqual(
    { openAsks: 0, projectError: 'Database unavailable' },
  )
})
