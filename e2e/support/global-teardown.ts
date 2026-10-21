// ABOUTME: Playwright globalTeardown — stops any dolt sql-server the seeds started, removes the
// ABOUTME: per-checkout e2e scan root, and releases this run's scan-root lock.

import { rmSync } from 'node:fs'
import process from 'node:process'
import { E2E_CHECKOUT_ROOT, E2E_SCAN_ROOT } from './bd'
import { stopDoltServersUnder } from './dolt-servers'
import { lockPathFor, readLock, releaseScanRootLock } from './lock'

export default async function globalTeardown(): Promise<void> {
  // globalSetup refuses to run when another checkout's run holds this scan root — and
  // playwright still runs teardown after that failure. Removing the directory then would
  // destroy the other run's seeds, which is the very collision this harness exists to stop.
  const held = readLock(lockPathFor(E2E_SCAN_ROOT))
  if (
    held !== null &&
    held.pid !== process.pid &&
    held.checkout !== E2E_CHECKOUT_ROOT
  )
    return

  // The stopped-dolt-server fixture is seeded with `bd init --server`, which starts a real
  // `dolt sql-server`. Anything still serving from inside the scan root belongs to this run.
  await stopDoltServersUnder(E2E_SCAN_ROOT)

  try {
    // The app server's bd/dolt processes may still be flushing lock files as the
    // webServer shuts down, so a single rm can race into ENOTEMPTY. Retry briefly.
    for (let attempt = 1; ; attempt++) {
      try {
        rmSync(E2E_SCAN_ROOT, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt >= 10) throw error
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  } finally {
    // A scan root this run could not remove is still not a scan root anyone else may use,
    // but leaving the lock behind would block the next run of this checkout forever.
    releaseScanRootLock(E2E_SCAN_ROOT, {
      pid: process.pid,
      checkout: E2E_CHECKOUT_ROOT,
    })
  }
}
