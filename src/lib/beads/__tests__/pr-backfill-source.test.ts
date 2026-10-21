// ABOUTME: Unit tests for the backfill's merged-PR-history source — the exact gh argv, the
// ABOUTME: per-row parse, and the soft failures (unreadable repo, non-JSON, no origin remote).

import { describe, expect, it, vi } from 'vitest'
import {
  BACKFILL_PR_LIMIT,
  backfillReposFor,
  ghPrHistoryArgs,
  readMergedPrHistory,
} from '../pr-backfill-source'

const ROW = {
  number: 42,
  url: 'https://github.com/o/r/pull/42',
  title: 'Ship the rail row',
  body: 'Closes pm-beads-a1',
  headRefName: 'feat/rail-row',
  mergedAt: '2026-08-20T12:00:00Z',
}

describe('ghPrHistoryArgs', () => {
  it('asks for the fields the extractor reads, merged only, within the window', () => {
    expect(ghPrHistoryArgs('o/r', '2026-03-01')).toEqual([
      'pr',
      'list',
      '--repo',
      'o/r',
      '--state',
      'merged',
      '--json',
      'number,url,title,body,headRefName,mergedAt',
      '--search',
      'merged:>=2026-03-01',
      '--limit',
      String(BACKFILL_PR_LIMIT),
    ])
  })
})

describe('readMergedPrHistory', () => {
  it('reads one repo once and returns its rows', async () => {
    const reader = vi.fn(async () => JSON.stringify([ROW]))
    const result = await readMergedPrHistory(
      ['o/r'],
      new Date('2026-03-01T00:00:00Z'),
      '/project',
      reader,
    )

    expect(reader).toHaveBeenCalledTimes(1)
    expect(reader).toHaveBeenCalledWith(
      ghPrHistoryArgs('o/r', '2026-03-01'),
      '/project',
    )
    expect(result).toEqual({ prs: [ROW], warnings: [] })
  })

  it('fills in the optional text fields gh can return as null', async () => {
    const reader = async () =>
      JSON.stringify([{ ...ROW, body: null, headRefName: null }])
    const { prs } = await readMergedPrHistory(
      ['o/r'],
      new Date(),
      '/project',
      reader,
    )
    expect(prs[0].body).toBe('')
    expect(prs[0].headRefName).toBe('')
  })

  it('drops one malformed row rather than the whole repo', async () => {
    const reader = async () =>
      JSON.stringify([ROW, { number: 'nope' }, { ...ROW, number: 43 }])
    const { prs, warnings } = await readMergedPrHistory(
      ['o/r'],
      new Date(),
      '/project',
      reader,
    )
    expect(prs.map((p) => p.number)).toEqual([42, 43])
    expect(warnings).toEqual([])
  })

  it('turns a repo gh cannot read into a warning and keeps the others', async () => {
    const reader = async (args: string[]) => {
      if (args.includes('bad/repo')) throw new Error('not found')
      return JSON.stringify([ROW])
    }
    const { prs, warnings } = await readMergedPrHistory(
      ['bad/repo', 'o/r'],
      new Date(),
      '/project',
      reader,
    )
    expect(prs).toHaveLength(1)
    expect(warnings).toEqual(['bad/repo: gh pr list failed — not found'])
  })

  it('warns rather than throwing when gh does not answer with JSON', async () => {
    const { prs, warnings } = await readMergedPrHistory(
      ['o/r'],
      new Date(),
      '/project',
      async () => 'gh: command not found',
    )
    expect(prs).toEqual([])
    expect(warnings).toEqual(['o/r: gh pr list did not return JSON'])
  })
})

describe('backfillReposFor', () => {
  it('is the origin remote, as owner/repo, lowercased', async () => {
    expect(
      await backfillReposFor('/project', async () => 'git@github.com:O/R.git'),
    ).toEqual({ repos: ['o/r'], warnings: [] })
  })

  it('warns instead of scanning when the project has no origin remote', async () => {
    const result = await backfillReposFor('/project', async () => null)
    expect(result.repos).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/origin/)
  })

  it('warns when the origin remote is not a GitHub repo', async () => {
    const result = await backfillReposFor(
      '/project',
      async () => 'https://gitlab.com/o/r.git',
    )
    expect(result.repos).toEqual([])
    expect(result.warnings[0]).toMatch(/GitHub/)
  })
})
