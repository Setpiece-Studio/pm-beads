// ABOUTME: Per-checkout e2e isolation — derives the dev-server port and the throwaway scan root
// ABOUTME: from a hash of the repo checkout path, and probes whether that port is already taken.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/** Ports the e2e dev server may land on. Deliberately clear of 8345 (the real dev server)
 * and 8347 (what this harness used before it was per-checkout), so a suite never talks to
 * a long-running server someone left up. */
export const E2E_PORT_RANGE_START = 8400
export const E2E_PORT_RANGE_END = 8999

const PORT_SPAN = E2E_PORT_RANGE_END - E2E_PORT_RANGE_START + 1

/** Eight hex characters of sha256 over the checkout path — short enough to read in a
 * directory name, wide enough that two checkouts practically never share one. */
export function checkoutHash(checkoutRoot: string): string {
  return createHash('sha256').update(checkoutRoot).digest('hex').slice(0, 8)
}

/** The port this checkout's e2e run owns. Two checkouts *can* collide (600 slots), which is
 * why global-setup refuses to start on a busy port instead of quietly sharing one. */
export function derivePort(checkoutRoot: string): number {
  const slot = Number.parseInt(checkoutHash(checkoutRoot), 16) % PORT_SPAN
  return E2E_PORT_RANGE_START + slot
}

/** The throwaway seed/scan directory this checkout's e2e run owns. */
export function deriveScanRoot(
  checkoutRoot: string,
  tmpDir: string = tmpdir(),
): string {
  return join(tmpDir, `pm-beads-e2e-${checkoutHash(checkoutRoot)}`)
}

/** The worktree root — a linked worktree reports its own path, not the main checkout's, so
 * every worktree gets its own port and scan root. Falls back to cwd outside a repo. */
export function resolveCheckoutRoot(cwd: string = process.cwd()): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return cwd
  }
}

type Env = Record<string, string | undefined>

/** E2E_PORT wins over the derived port; anything unusable is a hard error rather than a
 * silent fallback, so a typo'd override never lands two runs on the same port. */
export function resolvePort(
  env: Env = process.env,
  checkoutRoot: string = resolveCheckoutRoot(),
): number {
  const override = env.E2E_PORT?.trim()
  if (override === undefined || override === '') return derivePort(checkoutRoot)
  const port = Number(override)
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(
      `E2E_PORT must be an integer port between 1 and 65535, got "${override}".`,
    )
  return port
}

/** E2E_SCAN_ROOT wins over the derived scan root. Whatever it names is wiped by
 * global-setup and removed by global-teardown, so it must be a throwaway directory. */
export function resolveScanRoot(
  env: Env = process.env,
  checkoutRoot: string = resolveCheckoutRoot(),
  tmpDir: string = tmpdir(),
): string {
  const override = env.E2E_SCAN_ROOT?.trim()
  if (override === undefined || override === '')
    return deriveScanRoot(checkoutRoot, tmpDir)
  return override
}

/** True when nothing is listening on the port. Binds with SO_REUSEADDR off (node's default
 * for listen) so a live listener reliably reports EADDRINUSE. */
export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen({ port, host, exclusive: true })
  })
}

/** Best-effort "who has this port?" for the refuse-to-collide message. Returns null when
 * lsof is missing (some CI images) or reports nothing. */
export function describePortHolder(port: number): string | null {
  let output: string
  try {
    output = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
  } catch {
    return null
  }
  const pid = /^p(\d+)$/m.exec(output)?.[1]
  const command = /^c(.+)$/m.exec(output)?.[1]
  if (pid === undefined) return null
  return command === undefined ? `pid ${pid}` : `pid ${pid} (${command})`
}
