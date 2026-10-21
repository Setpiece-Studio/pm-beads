// ABOUTME: Unit tests for the inbox sidecar block — the read-id merge and its cap, plus reading
// ABOUTME: and writing inbox.readActivityIds / inbox.activitySince beside env and sweep.

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
import {
  ACTIVITY_READ_ID_CAP,
  markActivityRead,
  markActivityUnread,
  mergeReadIds,
  readInboxConfig,
} from '../inbox-store'

describe('mergeReadIds', () => {
  it('puts the newly read ids first and dedupes', () => {
    expect(mergeReadIds(['a', 'b'], ['b', 'c'])).toEqual(['b', 'c', 'a'])
  })

  it('keeps the existing order for ids that are not re-read', () => {
    expect(mergeReadIds(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
  })

  it('caps the list, dropping the oldest read state', () => {
    const existing = Array.from(
      { length: ACTIVITY_READ_ID_CAP },
      (_, i) => `old-${i}`,
    )

    const merged = mergeReadIds(existing, ['fresh'])

    expect(merged).toHaveLength(ACTIVITY_READ_ID_CAP)
    expect(merged[0]).toBe('fresh')
    expect(merged).not.toContain(`old-${ACTIVITY_READ_ID_CAP - 1}`)
  })
})

describe('the inbox sidecar block', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pm-beads-inbox-store-'))
    mkdirSync(join(dir, '.beads'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function sidecar(): Record<string, unknown> {
    return JSON.parse(
      readFileSync(join(dir, '.beads', 'pm-beads.json'), 'utf8'),
    )
  }

  function writeSidecar(value: unknown): void {
    writeFileSync(
      join(dir, '.beads', 'pm-beads.json'),
      `${JSON.stringify(value, null, 2)}\n`,
    )
  }

  it('reads an empty block from a project with no sidecar', () => {
    expect(readInboxConfig(dir)).toEqual({ readActivityIds: [] })
  })

  it('reads an empty block from an unparseable sidecar', () => {
    writeFileSync(join(dir, '.beads', 'pm-beads.json'), '{ not json')

    expect(readInboxConfig(dir)).toEqual({ readActivityIds: [] })
  })

  it('drops a hand-edited key of the wrong type without losing the other', () => {
    writeSidecar({
      version: 1,
      inbox: { readActivityIds: 'nope', activitySince: '2026-08-01T00:00:00Z' },
    })

    expect(readInboxConfig(dir)).toEqual({
      readActivityIds: [],
      activitySince: '2026-08-01T00:00:00Z',
    })
  })

  it('records read ids without disturbing the env and sweep blocks', async () => {
    writeSidecar({
      version: 1,
      env: { vars: { BEADS_ACTOR: 'ben' } },
      sweep: { enabled: true, lastRunAt: '2026-08-26T00:00:00Z' },
    })

    await markActivityRead(dir, ['comment:c1', 'human:pb-1'])

    expect(sidecar()).toMatchObject({
      version: 1,
      env: { vars: { BEADS_ACTOR: 'ben' } },
      sweep: { enabled: true, lastRunAt: '2026-08-26T00:00:00Z' },
      inbox: { readActivityIds: ['comment:c1', 'human:pb-1'] },
    })
  })

  it('advances activitySince only forward', async () => {
    await markActivityRead(dir, ['a'], '2026-08-10T00:00:00Z')
    await markActivityRead(dir, ['b'], '2026-08-01T00:00:00Z')

    expect(readInboxConfig(dir).activitySince).toBe('2026-08-10T00:00:00Z')

    await markActivityRead(dir, ['c'], '2026-08-20T00:00:00Z')
    expect(readInboxConfig(dir).activitySince).toBe('2026-08-20T00:00:00Z')
  })

  it('marks an item unread again by dropping its id', async () => {
    await markActivityRead(dir, ['a', 'b'])

    await markActivityUnread(dir, ['a'])

    expect(readInboxConfig(dir).readActivityIds).toEqual(['b'])
  })

  it('refuses to rewrite a sidecar it cannot parse', async () => {
    writeFileSync(join(dir, '.beads', 'pm-beads.json'), '{ not json')

    await expect(markActivityRead(dir, ['a'])).rejects.toThrow(
      'is not valid JSON',
    )
  })
})
