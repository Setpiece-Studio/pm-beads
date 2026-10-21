// ABOUTME: Shared read/write for the app-owned .beads/pm-beads.json sidecar — a lenient object
// ABOUTME: read, and an atomic update that refuses to rewrite a file it could not parse.

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { withProcessLock } from './cli'
import { sidecarFilePath } from './project-env'

/**
 * The sidecar as a plain object, or null when it is absent, unreadable, not JSON, or not an
 * object. Never throws: every reader of this file treats a broken sidecar as an absent one.
 */
export function readSidecarObject(
  projectDir: string,
): Record<string, unknown> | null {
  let raw: string
  try {
    raw = readFileSync(sidecarFilePath(projectDir), 'utf8')
  } catch {
    return null
  }
  return asObject(raw)
}

/**
 * Rewrite the sidecar with `mutate` applied to a shallow copy of it, leaving every key the
 * mutation does not touch — `env` above all — exactly as it was.
 *
 * REJECTS rather than rewriting a sidecar that does not parse: that file is hand-editable and
 * a typo in `env` must not cost someone their project configuration. Held under the same
 * process lock bd calls use, so two writers cannot interleave read-modify-write.
 *
 * Writing bumps the sidecar's mtime, which invalidates the project's cached bd environment
 * (project-env.ts keys its cache on that mtime) — one extra `mise env --json` on the next call.
 */
export function updateSidecar(
  projectDir: string,
  mutate: (sidecar: Record<string, unknown>) => void,
): Promise<void> {
  return withProcessLock(async () => {
    const path = sidecarFilePath(projectDir)
    let raw: string | null
    try {
      raw = readFileSync(path, 'utf8')
    } catch {
      raw = null
    }

    let sidecar: Record<string, unknown> = { version: 1 }
    if (raw !== null) {
      const parsed = asObject(raw)
      if (parsed === null) {
        throw new Error(
          `${path} is not valid JSON, or is not a JSON object; not rewriting it`,
        )
      }
      sidecar = { ...parsed }
    }

    mutate(sidecar)

    // Atomic write, same shape as views-store: tmp file beside the target, then rename over it.
    const tmp = `${path}.tmp-${process.pid}`
    writeFileSync(tmp, `${JSON.stringify(sidecar, null, 2)}\n`)
    renameSync(tmp, path)
  })
}

function asObject(raw: string): Record<string, unknown> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    return null
  return parsed as Record<string, unknown>
}
