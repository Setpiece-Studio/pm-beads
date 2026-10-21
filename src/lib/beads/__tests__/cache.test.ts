// ABOUTME: Unit coverage for the server-process bd read cache and in-memory filters.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearBdCachesForTest } from '../cache'
import { createIssue } from '../mutations'
import { listIssues } from '../queries'
import type { Issue } from '../types'

const cliMocks = vi.hoisted(() => ({
  runBdJson: vi.fn(),
  runBdWriteJson: vi.fn(),
}))

vi.mock('../cli', () => ({
  beadsProjectDir: () => '/default/project',
  runBd: vi.fn(),
  runBdJson: cliMocks.runBdJson,
  runBdWrite: vi.fn(),
  runBdWriteJson: cliMocks.runBdWriteJson,
}))

function issue(patch: Partial<Issue> & Pick<Issue, 'id' | 'title'>): Issue {
  return {
    status: 'open',
    priority: 2,
    issue_type: 'task',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...patch,
  }
}

describe('bd read cache', () => {
  beforeEach(() => {
    clearBdCachesForTest()
    cliMocks.runBdJson.mockReset()
    cliMocks.runBdWriteJson.mockReset()
  })

  it('reuses a cached all-issues snapshot for repeated list queries', async () => {
    cliMocks.runBdJson.mockResolvedValueOnce([
      issue({ id: 'bds-1', title: 'Open task' }),
      issue({ id: 'bds-2', title: 'Closed bug', status: 'closed' }),
    ])

    await expect(listIssues({}, { cwd: '/repo' })).resolves.toHaveLength(1)
    await expect(
      listIssues({ all: true }, { cwd: '/repo' }),
    ).resolves.toHaveLength(2)

    expect(cliMocks.runBdJson).toHaveBeenCalledTimes(1)
    expect(cliMocks.runBdJson).toHaveBeenCalledWith(
      ['list', '--json', '--all', '--limit', '0'],
      { cwd: '/repo' },
    )
  })

  it('dedupes concurrent all-issues loads for the same project', async () => {
    let resolve: ((value: Issue[]) => void) | undefined
    const loading = new Promise<Issue[]>((done) => {
      resolve = done
    })
    cliMocks.runBdJson.mockReturnValueOnce(loading)

    const first = listIssues({ all: true }, { cwd: '/repo' })
    const second = listIssues({ types: ['task'] }, { cwd: '/repo' })

    expect(resolve).toBeDefined()
    resolve?.([issue({ id: 'bds-1', title: 'Task' })])

    await expect(first).resolves.toHaveLength(1)
    await expect(second).resolves.toHaveLength(1)
    expect(cliMocks.runBdJson).toHaveBeenCalledTimes(1)
  })

  it('preserves recursive bd list --parent semantics in memory', async () => {
    cliMocks.runBdJson.mockResolvedValueOnce([
      issue({ id: 'bds-epic', title: 'Epic', issue_type: 'epic' }),
      issue({ id: 'bds-child', title: 'Child', parent: 'bds-epic' }),
      issue({ id: 'bds-grandchild', title: 'Grandchild', parent: 'bds-child' }),
      issue({ id: 'bds-other', title: 'Other' }),
    ])

    const children = await listIssues(
      { all: true, parent: 'bds-epic' },
      { cwd: '/repo' },
    )

    expect(children.map((item) => item.id)).toEqual([
      'bds-child',
      'bds-grandchild',
    ])
  })

  it('selects only immediate children with directParent', async () => {
    cliMocks.runBdJson.mockResolvedValueOnce([
      issue({ id: 'bds-epic', title: 'Epic', issue_type: 'epic' }),
      issue({ id: 'bds-child', title: 'Child', parent: 'bds-epic' }),
      issue({ id: 'bds-grandchild', title: 'Grandchild', parent: 'bds-child' }),
    ])

    const children = await listIssues(
      { all: true, directParent: 'bds-epic' },
      { cwd: '/repo' },
    )

    expect(children.map((item) => item.id)).toEqual(['bds-child'])
  })

  it('invalidates cached project reads after a write', async () => {
    cliMocks.runBdJson
      .mockResolvedValueOnce([issue({ id: 'bds-1', title: 'Before' })])
      .mockResolvedValueOnce([
        issue({ id: 'bds-1', title: 'Before' }),
        issue({ id: 'bds-2', title: 'After' }),
      ])
    cliMocks.runBdWriteJson.mockResolvedValueOnce(
      issue({ id: 'bds-2', title: 'After' }),
    )

    await expect(
      listIssues({ all: true }, { cwd: '/repo' }),
    ).resolves.toHaveLength(1)
    await createIssue(
      { title: 'After', type: 'task', priority: 2 },
      { cwd: '/repo' },
    )
    await expect(
      listIssues({ all: true }, { cwd: '/repo' }),
    ).resolves.toHaveLength(2)

    expect(cliMocks.runBdJson).toHaveBeenCalledTimes(2)
  })
})
