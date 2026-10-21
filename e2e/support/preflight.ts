// ABOUTME: Runs ahead of the e2e dev server (webServer starts before globalSetup) and refuses
// ABOUTME: to launch when this checkout's port or scan root is already busy with another run.

import process from 'node:process'
import {
  E2E_BASE_URL,
  E2E_CHECKOUT_ROOT,
  E2E_PORT,
  E2E_SCAN_ROOT,
} from './bd'
import { describePortHolder, isPortFree } from './isolation'
import { isLockStale, lockHeldMessage, lockPathFor, readLock } from './lock'

/** Both halves of "is this checkout's slice of the machine free?". Throws with a message
 * naming the other process rather than letting two runs quietly share a port or seed dir. */
export async function preflight(): Promise<void> {
  if (!(await isPortFree(E2E_PORT))) {
    const holder = describePortHolder(E2E_PORT) ?? 'an unidentified process'
    throw new Error(
      [
        `e2e port ${E2E_PORT} (${E2E_BASE_URL}) is already in use by ${holder}.`,
        `\nThis checkout (${E2E_CHECKOUT_ROOT}) derives that port from its path, so the`,
        ' holder is either another e2e run, a leftover dev server, or an unrelated service.',
        '\nStop it, or run this suite elsewhere with E2E_PORT=<free port> bun run test:e2e.',
      ].join(''),
    )
  }

  // Read-only here; global-setup does the atomic claim once the server is up.
  const held = readLock(lockPathFor(E2E_SCAN_ROOT))
  if (held !== null && !isLockStale(held)) throw new Error(lockHeldMessage(E2E_SCAN_ROOT, held))
}

await preflight().catch((error: unknown) => {
  console.error(`\ne2e preflight failed:\n${(error as Error).message}\n`)
  process.exit(1)
})
