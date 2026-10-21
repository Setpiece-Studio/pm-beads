// ABOUTME: Tests that the status pipeline is read per project — sidecar, bd config, and beads.
// ABOUTME: Real sidecar files in temp dirs; only the bd CLI boundary is stubbed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearBdCachesForTest, invalidateBdCache } from '../cache'
import { readStatusPipeline } from '../status-config'
import type { Issue } from '../types'

const cliMocks = vi.hoisted(() => ({ runBdJson: vi.fn() }))

vi.mock('../cli', () => ({
  beadsProjectDir: () => '/default/project',
  runBd: vi.fn(),
  runBdJson: cliMocks.runBdJson,
  runBdWrite: vi.fn(),
  runBdWriteJson: vi.fn(),
}))

const dirs: string[] = []

/** A throwaway project directory carrying a real `.beads/pm-beads.json`. */
function project(sidecar: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'pm-beads-status-'))
  dirs.push(dir)
  mkdirSync(join(dir, '.beads'), { recursive: true })
  writeFileSync(
    join(dir, '.beads', 'pm-beads.json'),
    JSON.stringify(sidecar),
    'utf8',
  )
  return dir
}

function issue(id: string, status: string): Issue {
  return {
    id,
    title: id,
    status,
    priority: 2,
    issue_type: 'task',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/**
 * Answer `bd list` and `bd config get status.custom` from a per-directory table, so a test
 * describes two projects and the reader has to pick the right one by `cwd`.
 */
function bdProjects(
  table: Record<string, { issues?: Issue[]; custom?: string }>,
) {
  cliMocks.runBdJson.mockImplementation(
    async (args: string[], opts: { cwd?: string } = {}) => {
      const entry = table[opts.cwd ?? ''] ?? {}
      if (args[0] === 'config') {
        if (entry.custom === undefined) throw new Error('unset')
        return { value: entry.custom }
      }
      return entry.issues ?? []
    },
  )
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

describe('readStatusPipeline', () => {
  beforeEach(() => {
    clearBdCachesForTest()
    cliMocks.runBdJson.mockReset()
  })

  it('shares concurrent configuration reads and invalidates after writes', async () => {
    const dir = project({ version: 1 })
    bdProjects({ [dir]: { custom: 'qa', issues: [issue('a', 'open')] } })
    await Promise.all([
      readStatusPipeline({ cwd: dir }),
      readStatusPipeline({ cwd: dir }),
    ])
    expect(
      cliMocks.runBdJson.mock.calls.filter(([args]) => args[0] === 'config'),
    ).toHaveLength(1)
    invalidateBdCache({ cwd: dir })
    await readStatusPipeline({ cwd: dir })
    expect(
      cliMocks.runBdJson.mock.calls.filter(([args]) => args[0] === 'config'),
    ).toHaveLength(2)
  })

  // Switching projects in the picker re-runs this read against another directory. Every input
  // is project-scoped — the sidecar order and icons, bd's own custom statuses, and the statuses
  // the beads are wearing — so nothing may leak from the project read before it.
  it('reads each project’s own sidecar, bd config, and beads', async () => {
    const shipping = project({
      version: 1,
      statuses: {
        pipeline: ['open', 'in_progress', 'awaiting_deploy', 'closed'],
        icons: { awaiting_deploy: 'rocket' },
      },
    })
    const reviewing = project({
      version: 1,
      statuses: {
        pipeline: ['open', 'in_review', 'closed'],
        icons: { in_review: 'eye' },
      },
    })
    bdProjects({
      [shipping]: {
        custom: 'awaiting_deploy',
        issues: [issue('s1', 'awaiting_deploy')],
      },
      [reviewing]: {
        custom: 'in_review,qa',
        issues: [issue('r1', 'qa')],
      },
    })

    expect(await readStatusPipeline({ cwd: shipping })).toEqual({
      authored: true,
      statuses: [
        'open',
        'in_progress',
        'awaiting_deploy',
        'deferred',
        'blocked',
        'closed',
      ],
      icons: { awaiting_deploy: 'rocket' },
    })

    expect(await readStatusPipeline({ cwd: reviewing })).toEqual({
      authored: true,
      statuses: [
        'open',
        'in_review',
        'qa',
        'deferred',
        'in_progress',
        'blocked',
        'closed',
      ],
      icons: { in_review: 'eye' },
    })
  })

  // The project this bead was filed for: bd knows the custom status names, the sidecar does not
  // order them yet. The statuses must still all be offered, with Done still last.
  it('falls back to the built-in order for a project with no statuses block', async () => {
    const dir = project({ version: 1 })
    bdProjects({
      [dir]: {
        custom: 'backlog,in_review,qa,awaiting_deploy,verification',
        issues: [issue('a', 'backlog')],
      },
    })

    const pipeline = await readStatusPipeline({ cwd: dir })
    expect(pipeline.authored).toBe(false)
    expect(pipeline.statuses).toEqual([
      'deferred',
      'open',
      'in_progress',
      'blocked',
      'backlog',
      'in_review',
      'qa',
      'awaiting_deploy',
      'verification',
      'closed',
    ])
    expect(pipeline.icons).toEqual({})
  })

  // Older bd builds have no `status.custom`; the read must still produce a usable pipeline.
  it('survives a bd that cannot report custom statuses', async () => {
    const dir = project({ version: 1 })
    bdProjects({ [dir]: { issues: [issue('a', 'verification')] } })

    expect((await readStatusPipeline({ cwd: dir })).statuses).toEqual([
      'deferred',
      'open',
      'in_progress',
      'blocked',
      'verification',
      'closed',
    ])
  })
})
