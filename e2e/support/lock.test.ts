// ABOUTME: Unit tests for the e2e scan-root lock — staleness (dead pid or an ancient record),
// ABOUTME: refusing to acquire a live lock, and releasing only the record this run wrote.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LOCK_STALE_MS,
  acquireScanRootLock,
  isLockStale,
  lockPathFor,
  readLock,
  releaseScanRootLock,
} from './lock'

const NOW = Date.parse('2026-08-27T12:00:00.000Z')
const alive = () => true
const dead = () => false

function lockRecord(overrides: Record<string, unknown> = {}) {
  return {
    pid: 4242,
    checkout: '/Users/dev/pm-beads',
    port: 8501,
    startedAt: new Date(NOW - 60_000).toISOString(),
    ...overrides,
  }
}

describe('isLockStale', () => {
  it('is not stale while the holder is alive and the record is recent', () => {
    expect(isLockStale(lockRecord(), { now: NOW, isProcessAlive: alive })).toBe(
      false,
    )
  })

  it('is stale once the holder process is gone', () => {
    expect(isLockStale(lockRecord(), { now: NOW, isProcessAlive: dead })).toBe(
      true,
    )
  })

  it('is stale past the age backstop even if some process holds that pid', () => {
    const ancient = lockRecord({
      startedAt: new Date(NOW - LOCK_STALE_MS - 1).toISOString(),
    })
    expect(isLockStale(ancient, { now: NOW, isProcessAlive: alive })).toBe(true)
  })

  it('treats an unparseable timestamp as stale', () => {
    const broken = lockRecord({ startedAt: 'not-a-date' })
    expect(isLockStale(broken, { now: NOW, isProcessAlive: alive })).toBe(true)
  })
})

describe('scan-root lock files', () => {
  let dir: string
  let scanRoot: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pm-beads-lock-test-'))
    scanRoot = join(dir, 'pm-beads-e2e-deadbeef')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the lock file beside the scan root, not inside it', () => {
    expect(lockPathFor(scanRoot)).toBe(`${scanRoot}.lock`)
  })

  it('writes a readable record naming the holder', () => {
    acquireScanRootLock(scanRoot, {
      pid: 4242,
      checkout: '/Users/dev/pm-beads',
      port: 8501,
      now: NOW,
      isProcessAlive: alive,
    })
    expect(readLock(lockPathFor(scanRoot))).toEqual(lockRecord({ startedAt: new Date(NOW).toISOString() }))
  })

  it('refuses to acquire a lock a live run holds, naming that run', () => {
    acquireScanRootLock(scanRoot, {
      pid: 4242,
      checkout: '/Users/dev/other-worktree',
      port: 8501,
      now: NOW,
      isProcessAlive: alive,
    })
    expect(() =>
      acquireScanRootLock(scanRoot, {
        pid: 99,
        checkout: '/Users/dev/pm-beads',
        port: 8501,
        now: NOW,
        isProcessAlive: alive,
      }),
    ).toThrow(/pid 4242.*other-worktree/s)
  })

  it('takes over a stale lock left by a dead run', () => {
    acquireScanRootLock(scanRoot, {
      pid: 4242,
      checkout: '/Users/dev/other-worktree',
      port: 8501,
      now: NOW,
      isProcessAlive: alive,
    })
    acquireScanRootLock(scanRoot, {
      pid: 99,
      checkout: '/Users/dev/pm-beads',
      port: 8501,
      now: NOW,
      isProcessAlive: dead,
    })
    expect(readLock(lockPathFor(scanRoot))?.pid).toBe(99)
  })

  it('takes over a corrupt lock file', () => {
    writeFileSync(lockPathFor(scanRoot), '{ not json')
    acquireScanRootLock(scanRoot, {
      pid: 99,
      checkout: '/Users/dev/pm-beads',
      port: 8501,
      now: NOW,
      isProcessAlive: alive,
    })
    expect(readLock(lockPathFor(scanRoot))?.pid).toBe(99)
  })

  it('reads a missing lock file as no lock', () => {
    expect(readLock(lockPathFor(scanRoot))).toBeNull()
  })

  it('releases only its own record', () => {
    acquireScanRootLock(scanRoot, {
      pid: 4242,
      checkout: '/Users/dev/other-worktree',
      port: 8501,
      now: NOW,
      isProcessAlive: alive,
    })
    releaseScanRootLock(scanRoot, { pid: 99 })
    expect(readLock(lockPathFor(scanRoot))?.pid).toBe(4242)
    releaseScanRootLock(scanRoot, { pid: 4242 })
    expect(readLock(lockPathFor(scanRoot))).toBeNull()
  })

  it('releases a lock its own checkout holds under a different pid', () => {
    acquireScanRootLock(scanRoot, {
      pid: 4242,
      checkout: '/Users/dev/pm-beads',
      port: 8501,
      now: NOW,
      isProcessAlive: alive,
    })
    releaseScanRootLock(scanRoot, { pid: 99, checkout: '/Users/dev/elsewhere' })
    expect(readLock(lockPathFor(scanRoot))?.pid).toBe(4242)
    releaseScanRootLock(scanRoot, { pid: 99, checkout: '/Users/dev/pm-beads' })
    expect(readLock(lockPathFor(scanRoot))).toBeNull()
  })

  it('releasing a lock that is already gone is a no-op', () => {
    expect(() => releaseScanRootLock(scanRoot, { pid: 4242 })).not.toThrow()
  })

  it('writes the lock record as JSON', () => {
    acquireScanRootLock(scanRoot, {
      pid: 4242,
      checkout: '/Users/dev/pm-beads',
      port: 8501,
      now: NOW,
      isProcessAlive: alive,
    })
    const raw = readFileSync(lockPathFor(scanRoot), 'utf8')
    expect(JSON.parse(raw).pid).toBe(4242)
  })
})
