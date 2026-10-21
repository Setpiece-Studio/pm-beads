// ABOUTME: A pid-stamped lock file guarding the e2e scan root, so a second run against the
// ABOUTME: same seed directory fails fast naming the run that holds it instead of clobbering it.

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import process from 'node:process'

/** A lock older than this is treated as abandoned even if something still holds its pid —
 * a backstop against pid reuse after a hard kill. Comfortably longer than any real run. */
export const LOCK_STALE_MS = 6 * 60 * 60 * 1000

export interface ScanRootLock {
  pid: number
  /** Checkout whose e2e run holds the lock — the useful half of the error message. */
  checkout: string
  port: number
  startedAt: string
}

export interface StalenessDeps {
  now?: number
  isProcessAlive?: (pid: number) => boolean
}

/** The lock lives *beside* the scan root, not inside it: global-setup wipes the scan root
 * as its first act, which would delete a lock nested within it. */
export function lockPathFor(scanRoot: string): string {
  return `${scanRoot}.lock`
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the pid exists but belongs to another user — still alive.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function isLockStale(
  lock: ScanRootLock,
  { now = Date.now(), isProcessAlive: alive = isProcessAlive }: StalenessDeps = {},
): boolean {
  const startedAt = Date.parse(lock.startedAt)
  if (Number.isNaN(startedAt)) return true
  if (now - startedAt > LOCK_STALE_MS) return true
  return !alive(lock.pid)
}

/** The lock record, or null when there is no lock file or it is unreadable/corrupt (a
 * half-written file from a killed run is no lock at all). */
export function readLock(lockPath: string): ScanRootLock | null {
  let raw: string
  try {
    raw = readFileSync(lockPath, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ScanRootLock>
    if (typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'string')
      return null
    return {
      pid: parsed.pid,
      checkout: String(parsed.checkout ?? 'unknown checkout'),
      port: Number(parsed.port ?? 0),
      startedAt: parsed.startedAt,
    }
  } catch {
    return null
  }
}

/** The refuse-to-collide message, shared by the preflight check and the acquire itself. */
export function lockHeldMessage(scanRoot: string, held: ScanRootLock): string {
  return [
    `The e2e scan root ${scanRoot} is already in use by pid ${held.pid}`,
    ` (checkout ${held.checkout}, port ${held.port}, started ${held.startedAt}).`,
    '\nWait for that run to finish, or point this one elsewhere with',
    ' E2E_SCAN_ROOT=... E2E_PORT=... bun run test:e2e.',
  ].join('')
}

export interface AcquireInput extends StalenessDeps {
  pid: number
  checkout: string
  port: number
}

/** Claim the scan root for this run, or throw naming the run that already has it. The
 * write uses O_EXCL so two runs racing the same free lock cannot both win. */
export function acquireScanRootLock(
  scanRoot: string,
  {
    pid,
    checkout,
    port,
    now = Date.now(),
    isProcessAlive: alive = isProcessAlive,
  }: AcquireInput,
): void {
  const lockPath = lockPathFor(scanRoot)
  const record: ScanRootLock = {
    pid,
    checkout,
    port,
    startedAt: new Date(now).toISOString(),
  }
  const body = `${JSON.stringify(record, null, 2)}\n`

  if (writeLockExclusive(lockPath, body)) return

  const held = readLock(lockPath)
  if (held !== null && !isLockStale(held, { now, isProcessAlive: alive }))
    throw new Error(lockHeldMessage(scanRoot, held))

  // Stale or corrupt: drop it and retry once. A second EEXIST means another run grabbed
  // the freed lock in between, which is exactly the collision we refuse to share.
  rmSync(lockPath, { force: true })
  if (writeLockExclusive(lockPath, body)) return
  throw new Error(
    `The e2e scan root ${scanRoot} was claimed by another run while this one was taking over a stale lock.`,
  )
}

/** Drop the lock, but only if this run still owns it — a run that lost its lock to a
 * stale-takeover must not delete the new holder's record. `checkout` matches too, because
 * playwright may run globalSetup and globalTeardown in different processes. */
export function releaseScanRootLock(
  scanRoot: string,
  { pid, checkout }: { pid: number; checkout?: string },
): void {
  const lockPath = lockPathFor(scanRoot)
  const held = readLock(lockPath)
  if (held === null) return
  if (held.pid !== pid && held.checkout !== checkout) return
  rmSync(lockPath, { force: true })
}

function writeLockExclusive(lockPath: string, body: string): boolean {
  try {
    writeFileSync(lockPath, body, { flag: 'wx' })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw error
  }
}
