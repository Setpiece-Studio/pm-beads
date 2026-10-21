// ABOUTME: Low-level bd CLI runner: spawns bd via execFile in the configured beads project dir
// ABOUTME: under that project's env, parses JSON from stdout, and serializes calls (single-writer).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveProjectEnv } from './project-env'

const execFileAsync = promisify(execFile)

export interface BdOptions {
  /** Beads project directory to run bd in. Defaults to beadsProjectDir(). */
  cwd?: string
  /** Extra environment variables for the bd process. */
  env?: Record<string, string>
}

export function beadsProjectDir(): string {
  return process.env.PM_BEADS_PROJECT_DIR ?? process.cwd()
}

/** Wall-clock cap on a single bd invocation. The process mutex serializes every bd
 * call, so a hung bd (e.g. a stale dolt exclusive lock from a crashed process) would
 * otherwise block the whole queue indefinitely. The timeout kills it and frees the lock. */
const BD_TIMEOUT_MS = 30_000

/** Run bd with the given args and return raw stdout. Stderr is ignored on success —
 * bd emits permission warnings there that are not errors.
 *
 * The project's own environment is layered onto the app's: in bd server mode the
 * auto-started dolt sql-server inherits whatever env the first bd call carried, so a
 * project whose dolt remote needs credentials (mise, a sidecar command) must contribute
 * them here or its pushes fail until someone restarts the server by hand. Resolution is
 * cached per project, so this costs a few stat calls per invocation. */
export async function runBd(
  args: string[],
  opts: BdOptions = {},
): Promise<string> {
  const cwd = opts.cwd ?? beadsProjectDir()
  const projectEnv = await resolveProjectEnv(cwd)
  return withProcessLock(async () => {
    try {
      const { stdout } = await execFileAsync('bd', args, {
        cwd,
        env: { ...process.env, ...projectEnv, ...opts.env },
        maxBuffer: 32 * 1024 * 1024,
        timeout: BD_TIMEOUT_MS,
      })
      return stdout
    } catch (error) {
      // execFile flags a timeout kill via `killed`; surface a clear message instead of
      // the opaque default so the caller knows bd hung rather than failed outright.
      if (
        error !== null &&
        typeof error === 'object' &&
        'killed' in error &&
        (error as { killed?: boolean }).killed
      ) {
        throw new Error(
          `bd command timed out after ${BD_TIMEOUT_MS / 1000}s: bd ${args.join(' ')}`,
        )
      }
      throw error
    }
  })
}

/** Run a read-only bd command and parse its stdout as JSON. Empty output parses as null. */
export async function runBdJson(
  args: string[],
  opts: BdOptions = {},
): Promise<unknown> {
  const stdout = await runBd(args, opts)
  const trimmed = stdout.trim()
  return trimmed === '' ? null : JSON.parse(trimmed)
}

// Embedded dolt allows only ONE bd process to hold the database at a time — even reads
// fail fast with "another process holds the exclusive lock". Every bd invocation is
// therefore chained through this promise mutex; concurrent calls queue instead of erroring.
let processLock: Promise<unknown> = Promise.resolve()

/** Exported so sidecar-file writers (saved views) serialize with bd calls too. */
export function withProcessLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = processLock.then(fn, fn)
  processLock = result.catch(() => undefined)
  return result
}

/** Run a bd write command; returns raw stdout. Kept as a distinct entry point so
 * mutation call sites read as writes, though all bd calls share the process lock. */
export function runBdWrite(
  args: string[],
  opts: BdOptions = {},
): Promise<string> {
  return runBd(args, opts)
}

/** Run a bd write command and parse stdout as JSON. */
export function runBdWriteJson(
  args: string[],
  opts: BdOptions = {},
): Promise<unknown> {
  return runBdJson(args, opts)
}
