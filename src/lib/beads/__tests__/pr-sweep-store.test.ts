// ABOUTME: Unit tests for the sweep's sidecar keys in .beads/pm-beads.json — lenient reads and
// ABOUTME: a lastRunAt write that preserves everything else the app-owned sidecar carries.

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
import { readSweepConfig, recordSweepRun } from '../pr-sweep-store'
import { sidecarFilePath } from '../project-env'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pm-beads-sweep-store-'))
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

describe('readSweepConfig', () => {
  it('is empty when the project has no sidecar at all', () => {
    expect(readSweepConfig(dir)).toEqual({})
  })

  it('is empty when the sidecar carries no sweep key', () => {
    writeSidecar({ version: 1, env: { vars: { BEADS_ACTOR: 'ben' } } })
    expect(readSweepConfig(dir)).toEqual({})
  })

  it('reads enabled and lastRunAt', () => {
    writeSidecar({
      version: 1,
      sweep: { enabled: true, lastRunAt: '2026-08-26T09:00:00Z' },
    })
    expect(readSweepConfig(dir)).toEqual({
      enabled: true,
      lastRunAt: '2026-08-26T09:00:00Z',
    })
  })

  it('is empty rather than throwing on unparseable JSON or a wrong-typed sweep key', () => {
    writeFileSync(sidecarFilePath(dir), '{ not json')
    expect(readSweepConfig(dir)).toEqual({})

    writeSidecar({ version: 1, sweep: 'yes please' })
    expect(readSweepConfig(dir)).toEqual({})
  })

  it('keeps the keys it understands when a sibling key is the wrong type', () => {
    writeSidecar({
      version: 1,
      sweep: { enabled: 'yes', lastRunAt: '2026-08-26T09:00:00Z' },
    })
    expect(readSweepConfig(dir)).toEqual({ lastRunAt: '2026-08-26T09:00:00Z' })
  })
})

describe('recordSweepRun', () => {
  it('creates the sidecar when the project has none', async () => {
    await recordSweepRun(dir, '2026-08-27T12:00:00.000Z')
    expect(readSidecar()).toEqual({
      version: 1,
      sweep: { lastRunAt: '2026-08-27T12:00:00.000Z' },
    })
    expect(readSweepConfig(dir).lastRunAt).toBe('2026-08-27T12:00:00.000Z')
  })

  it('preserves the env block and the sweep.enabled flag beside it', async () => {
    writeSidecar({
      version: 1,
      env: { command: 'mise env --json', vars: { BEADS_ACTOR: 'ben' } },
      sweep: { enabled: true, lastRunAt: '2026-08-01T00:00:00Z' },
    })

    await recordSweepRun(dir, '2026-08-27T12:00:00.000Z')

    expect(readSidecar()).toEqual({
      version: 1,
      env: { command: 'mise env --json', vars: { BEADS_ACTOR: 'ben' } },
      sweep: { enabled: true, lastRunAt: '2026-08-27T12:00:00.000Z' },
    })
  })

  it('refuses to overwrite a sidecar it cannot parse — a typo in env is not ours to discard', async () => {
    writeFileSync(sidecarFilePath(dir), '{ not json')
    await expect(
      recordSweepRun(dir, '2026-08-27T12:00:00.000Z'),
    ).rejects.toThrow(/not valid JSON/)
    expect(readFileSync(sidecarFilePath(dir), 'utf8')).toBe('{ not json')
  })
})
