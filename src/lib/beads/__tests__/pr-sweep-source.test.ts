// ABOUTME: Unit tests for the sweep's merged-PR source — the exact gh argv it builds and its
// ABOUTME: per-repo soft failure, with the gh reader injected instead of shelling out.

import { describe, expect, it } from 'vitest'
import { ghPrListArgs, readMergedPrs } from '../pr-sweep-source'

const SINCE = new Date('2026-08-25T00:00:00Z')

const REPOS = [
  { repo: 'e2e-owner/e2e-repo', numbers: [42, 43] },
  { repo: 'other-owner/other-repo', numbers: [7] },
]

function payload(entries: { number: number; url: string; mergedAt: string }[]) {
  return JSON.stringify(entries)
}

describe('ghPrListArgs', () => {
  it('asks one repo for merged PRs in the window, with the fields the plan needs', () => {
    expect(ghPrListArgs('e2e-owner/e2e-repo', '2026-08-25')).toEqual([
      'pr',
      'list',
      '--repo',
      'e2e-owner/e2e-repo',
      '--state',
      'merged',
      '--json',
      'number,url,mergedAt',
      '--search',
      'merged:>=2026-08-25',
      '--limit',
      '200',
    ])
  })
})

describe('readMergedPrs', () => {
  it('reads every repo once and concatenates the merged PRs', async () => {
    const calls: string[][] = []
    const result = await readMergedPrs(REPOS, SINCE, '/tmp/project', (args) => {
      calls.push(args)
      return Promise.resolve(
        payload([
          {
            number: 42,
            url: 'https://github.com/e2e-owner/e2e-repo/pull/42',
            mergedAt: '2026-08-26T09:00:00Z',
          },
        ]),
      )
    })

    expect(calls).toEqual([
      ghPrListArgs('e2e-owner/e2e-repo', '2026-08-25'),
      ghPrListArgs('other-owner/other-repo', '2026-08-25'),
    ])
    expect(result.warnings).toEqual([])
    expect(result.merged).toHaveLength(2)
    expect(result.merged[0].number).toBe(42)
  })

  it('warns and keeps going when one repo fails', async () => {
    const result = await readMergedPrs(REPOS, SINCE, '/tmp/project', (args) => {
      if (args.includes('other-owner/other-repo')) {
        return Promise.reject(new Error('gh: not authenticated'))
      }
      return Promise.resolve(
        payload([
          {
            number: 43,
            url: 'https://github.com/e2e-owner/e2e-repo/pull/43',
            mergedAt: '2026-08-26T09:00:00Z',
          },
        ]),
      )
    })

    expect(result.merged.map((pr) => pr.number)).toEqual([43])
    expect(result.warnings).toEqual([
      'other-owner/other-repo: gh pr list failed — gh: not authenticated',
    ])
  })

  it('warns on a payload gh did not shape the way we expect', async () => {
    const result = await readMergedPrs([REPOS[0]], SINCE, '/tmp/project', () =>
      Promise.resolve('not json at all'),
    )

    expect(result.merged).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('e2e-owner/e2e-repo')
  })

  it('drops entries with no mergedAt rather than failing the repo', async () => {
    const result = await readMergedPrs([REPOS[0]], SINCE, '/tmp/project', () =>
      Promise.resolve(
        JSON.stringify([
          {
            number: 1,
            url: 'https://github.com/e2e-owner/e2e-repo/pull/1',
            mergedAt: null,
          },
          {
            number: 2,
            url: 'https://github.com/e2e-owner/e2e-repo/pull/2',
            mergedAt: '2026-08-26T09:00:00Z',
          },
        ]),
      ),
    )

    expect(result.merged.map((pr) => pr.number)).toEqual([2])
    expect(result.warnings).toEqual([])
  })

  it('reads nothing and warns about nothing when no bead points at a repo', async () => {
    const result = await readMergedPrs([], SINCE, '/tmp/project', () => {
      throw new Error('gh must not run')
    })
    expect(result).toEqual({ merged: [], warnings: [] })
  })
})
