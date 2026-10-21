// ABOUTME: Unit tests for the backfill's sidecar key (backfill.skipped) in .beads/pm-beads.json
// ABOUTME: — lenient reads, and appends that neither duplicate nor disturb the env/sweep blocks.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBackfillConfig, recordBackfillSkips } from '../pr-backfill-store'
import { sidecarFilePath } from '../project-env'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pm-beads-backfill-store-'))
  mkdirSync(join(dir, '.beads'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeSidecar(value: unknown): void {
  writeFileSync(sidecarFilePath(dir), JSON.stringify(value, null, 2))
}

function readSidecar(): Record<string, unknown> {
  return JSON.parse(readFileSync(sidecarFilePath(dir), 'utf8'))
}

describe('readBackfillConfig', () => {
  it('is empty when the project has no sidecar, or none of this block', () => {
    expect(readBackfillConfig(dir)).toEqual({ skipped: [] })
    writeSidecar({ version: 1, sweep: { enabled: true } })
    expect(readBackfillConfig(dir)).toEqual({ skipped: [] })
  })

  it('reads the skipped ids', () => {
    writeSidecar({
      version: 1,
      backfill: { skipped: ['pm-beads-a1', 'pm-beads-b2'] },
    })
    expect(readBackfillConfig(dir).skipped).toEqual([
      'pm-beads-a1',
      'pm-beads-b2',
    ])
  })

  it('is empty rather than throwing on unparseable JSON or a wrong-typed block', () => {
    writeFileSync(sidecarFilePath(dir), '{ not json')
    expect(readBackfillConfig(dir)).toEqual({ skipped: [] })

    writeSidecar({ version: 1, backfill: { skipped: 'pm-beads-a1' } })
    expect(readBackfillConfig(dir)).toEqual({ skipped: [] })
  })

  it('drops the entries it cannot use and keeps the rest', () => {
    writeSidecar({ version: 1, backfill: { skipped: ['pm-beads-a1', 7, ''] } })
    expect(readBackfillConfig(dir).skipped).toEqual(['pm-beads-a1'])
  })
})

describe('recordBackfillSkips', () => {
  it('creates the sidecar when the project has none', async () => {
    await recordBackfillSkips(dir, ['pm-beads-a1'])
    expect(readSidecar()).toEqual({
      version: 1,
      backfill: { skipped: ['pm-beads-a1'] },
    })
  })

  it('unions with what is already skipped, sorted and deduped', async () => {
    await recordBackfillSkips(dir, ['pm-beads-b2', 'pm-beads-a1'])
    await recordBackfillSkips(dir, ['pm-beads-a1', 'pm-beads-c3'])
    expect(readBackfillConfig(dir).skipped).toEqual([
      'pm-beads-a1',
      'pm-beads-b2',
      'pm-beads-c3',
    ])
  })

  it('leaves the env and sweep blocks exactly as they were', async () => {
    writeSidecar({
      version: 1,
      env: { command: 'mise env --json', vars: { BEADS_ACTOR: 'ben' } },
      sweep: { enabled: true, lastRunAt: '2026-08-01T00:00:00Z' },
    })

    await recordBackfillSkips(dir, ['pm-beads-a1'])

    expect(readSidecar()).toEqual({
      version: 1,
      env: { command: 'mise env --json', vars: { BEADS_ACTOR: 'ben' } },
      sweep: { enabled: true, lastRunAt: '2026-08-01T00:00:00Z' },
      backfill: { skipped: ['pm-beads-a1'] },
    })
  })

  it('writes nothing when there is nothing to skip', async () => {
    await recordBackfillSkips(dir, [])
    expect(() => readSidecar()).toThrow()
  })

  it('refuses to overwrite a sidecar it cannot parse', async () => {
    writeFileSync(sidecarFilePath(dir), '{ not json')
    await expect(recordBackfillSkips(dir, ['pm-beads-a1'])).rejects.toThrow(
      /not valid JSON/,
    )
    expect(readFileSync(sidecarFilePath(dir), 'utf8')).toBe('{ not json')
  })
})
