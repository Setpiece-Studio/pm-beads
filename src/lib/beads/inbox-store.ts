// ABOUTME: The inbox's half of the .beads/pm-beads.json sidecar — per-project activity read
// ABOUTME: state (capped id list) and the feed's window floor, written beside env and sweep.

import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { z } from 'zod'
import { withProcessLock } from './cli'
import { sidecarFilePath } from './project-env'

/**
 * How many activity items keep read state. Matched to ACTIVITY_ITEM_CAP: an item that falls off
 * the end of the feed also falls out of this list, so the two age out together and the file
 * never grows without bound.
 */
export const ACTIVITY_READ_ID_CAP = 500

/** The sidecar's `inbox` block. Both keys optional — a project that has never had its Activity
 * tab opened has no block at all. */
export interface InboxSidecarConfig {
  /** Activity item ids the viewer has read, most recently read first, capped. */
  readActivityIds: string[]
  /** ISO instant the feed starts from. Absent means the default 30-day window. */
  activitySince?: string
}

// Each key is validated on its own, the same leniency the sweep block applies: one hand-edited
// value of the wrong type costs that key, not the whole block.
const inboxBlockSchema = z.object({
  readActivityIds: z.array(z.string()).optional().catch(undefined),
  activitySince: z.string().min(1).optional().catch(undefined),
})

/** Newly read ids first, then the previous list, deduped and capped. Read order is the only
 * recency signal the stored ids carry, so re-reading an item refreshes its place. */
export function mergeReadIds(
  existing: readonly string[],
  added: readonly string[],
  cap: number = ACTIVITY_READ_ID_CAP,
): string[] {
  return [...new Set([...added, ...existing])].slice(0, cap)
}

/** The project's inbox read state. Never throws: a missing, unreadable, or malformed sidecar
 * reads as an empty block, exactly like an absent one. */
export function readInboxConfig(projectDir: string): InboxSidecarConfig {
  const sidecar = readSidecarObject(projectDir)
  if (sidecar === null) return { readActivityIds: [] }
  const parsed = inboxBlockSchema.safeParse(sidecar.inbox)
  if (!parsed.success) return { readActivityIds: [] }
  const config: InboxSidecarConfig = {
    readActivityIds: parsed.data.readActivityIds ?? [],
  }
  if (parsed.data.activitySince !== undefined)
    config.activitySince = parsed.data.activitySince
  return config
}

/**
 * Mark activity items read. `since` advances `inbox.activitySince` when the feed was capped:
 * everything older than the oldest item still rendered has lost its read state to the cap, so
 * the floor moves with it rather than letting those items resurface as unread. It only ever
 * moves forward — a shorter window from a stale tab never rolls it back.
 */
export function markActivityRead(
  projectDir: string,
  ids: readonly string[],
  since?: string,
): Promise<InboxSidecarConfig> {
  return updateInboxBlock(projectDir, (current) => ({
    readActivityIds: mergeReadIds(current.readActivityIds, ids),
    activitySince:
      since !== undefined &&
      (current.activitySince === undefined || since > current.activitySince)
        ? since
        : current.activitySince,
  }))
}

/** Mark activity items unread again — the inverse, dropping their ids from the read list. */
export function markActivityUnread(
  projectDir: string,
  ids: readonly string[],
): Promise<InboxSidecarConfig> {
  const dropped = new Set(ids)
  return updateInboxBlock(projectDir, (current) => ({
    ...current,
    readActivityIds: current.readActivityIds.filter((id) => !dropped.has(id)),
  }))
}

/**
 * Rewrite the `inbox` block, leaving every other key — `env` and `sweep` above all — as it was.
 * Rejects rather than rewriting a sidecar that does not parse: that file is hand-editable and a
 * typo in `env` must not cost someone their project configuration.
 *
 * Writing it bumps the sidecar's mtime, which invalidates the project's cached bd environment
 * (project-env.ts keys its cache on that mtime) — one extra `mise env --json` on the next call.
 */
function updateInboxBlock(
  projectDir: string,
  apply: (current: InboxSidecarConfig) => InboxSidecarConfig,
): Promise<InboxSidecarConfig> {
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
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error(`${path} is not valid JSON; not recording inbox state`)
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      )
        throw new Error(
          `${path} is not a JSON object; not recording inbox state`,
        )
      sidecar = { ...(parsed as Record<string, unknown>) }
    }

    const existing = inboxBlockSchema.safeParse(sidecar.inbox)
    const current: InboxSidecarConfig = existing.success
      ? {
          readActivityIds: existing.data.readActivityIds ?? [],
          ...(existing.data.activitySince !== undefined && {
            activitySince: existing.data.activitySince,
          }),
        }
      : { readActivityIds: [] }

    const next = apply(current)
    sidecar.inbox = {
      readActivityIds: next.readActivityIds,
      ...(next.activitySince !== undefined && {
        activitySince: next.activitySince,
      }),
    }

    // Atomic write, same shape as views-store: tmp file beside the target, then rename over it.
    const tmp = `${path}.tmp-${process.pid}`
    writeFileSync(tmp, `${JSON.stringify(sidecar, null, 2)}\n`)
    renameSync(tmp, path)
    return next
  })
}

function readSidecarObject(projectDir: string): Record<string, unknown> | null {
  let raw: string
  try {
    raw = readFileSync(sidecarFilePath(projectDir), 'utf8')
  } catch {
    return null
  }
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
