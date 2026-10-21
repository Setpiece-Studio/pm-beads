// ABOUTME: Small server-process read-through cache for expensive bd list reads.
// ABOUTME: It dedupes concurrent loads and invalidates per project after writes.

import { z } from 'zod'
import { type BdOptions, beadsProjectDir, runBdJson } from './cli'
import { type ActivitySnapshot, fetchActivitySnapshot } from './inbox-activity'
import { MESSAGE_ISSUE_TYPE } from './messages'
import { parseConfiguredStatuses } from './status-model'
import {
  type EpicStatus,
  epicStatusSchema,
  type Issue,
  issueSchema,
  type Memory,
  type Message,
  memorySchema,
  messageSchema,
} from './types'

const CACHE_TTL_MS = 10_000

interface CacheEntry<T> {
  value?: T
  expiresAt: number
  loading?: Promise<T>
}

interface ProjectCache {
  customStatuses?: CacheEntry<string[]>
  allIssues?: CacheEntry<Issue[]>
  allMessages?: CacheEntry<Message[]>
  epicStatuses?: CacheEntry<EpicStatus[]>
  memories?: CacheEntry<Memory[]>
  activitySnapshot?: CacheEntry<ActivitySnapshot>
}

const caches = new Map<string, ProjectCache>()

/** Shared by list ordering, detail navigation and status editors. App writes invalidate it. */
export async function getCachedCustomStatuses(
  opts: BdOptions = {},
): Promise<string[]> {
  const cache = projectCache(opts)
  return readThrough(
    cache.customStatuses,
    (entry) => {
      cache.customStatuses = entry
    },
    async () => {
      try {
        const raw = await runBdJson(
          ['config', 'get', 'status.custom', '--json'],
          opts,
        )
        return parseConfiguredStatuses(
          typeof raw === 'object' && raw !== null && 'value' in raw
            ? raw.value
            : undefined,
        )
      } catch {
        // Older bd versions do not expose this setting. Observed statuses remain available.
        return []
      }
    },
  )
}

function projectKey(opts: BdOptions): string {
  return opts.cwd ?? beadsProjectDir()
}

function projectCache(opts: BdOptions): ProjectCache {
  const key = projectKey(opts)
  let cache = caches.get(key)
  if (!cache) {
    cache = {}
    caches.set(key, cache)
  }
  return cache
}

async function readThrough<T>(
  entry: CacheEntry<T> | undefined,
  setEntry: (entry: CacheEntry<T>) => void,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now()
  if (entry?.value !== undefined && entry.expiresAt > now) return entry.value
  if (entry?.loading) return entry.loading

  const next: CacheEntry<T> = { expiresAt: 0 }
  next.loading = load()
    .then((value) => {
      next.value = value
      next.expiresAt = Date.now() + CACHE_TTL_MS
      return value
    })
    .finally(() => {
      next.loading = undefined
    })
  setEntry(next)
  return next.loading
}

export function invalidateBdCache(opts: BdOptions = {}): void {
  caches.delete(projectKey(opts))
}

export function clearBdCachesForTest(): void {
  caches.clear()
}

export async function getCachedAllIssues(
  opts: BdOptions = {},
): Promise<Issue[]> {
  const cache = projectCache(opts)
  return readThrough(
    cache.allIssues,
    (entry) => {
      cache.allIssues = entry
    },
    async () => {
      const raw = await runBdJson(
        ['list', '--json', '--all', '--limit', '0'],
        opts,
      )
      return z.array(issueSchema).parse(raw ?? [])
    },
  )
}

/** Every message wisp, read and unread. Messages are infrastructure beads that plain `bd list`
 * hides, so this read needs --include-infra; --all keeps read (closed) messages for thread
 * reconstruction, and --limit 0 lifts bd's default 50-row cap. Callers filter in memory. */
export async function getCachedAllMessages(
  opts: BdOptions = {},
): Promise<Message[]> {
  const cache = projectCache(opts)
  return readThrough(
    cache.allMessages,
    (entry) => {
      cache.allMessages = entry
    },
    async () => {
      const raw = await runBdJson(
        [
          'list',
          '--json',
          '--include-infra',
          '--type',
          MESSAGE_ISSUE_TYPE,
          '--all',
          '--limit',
          '0',
        ],
        opts,
      )
      return z.array(messageSchema).parse(raw ?? [])
    },
  )
}

export async function getCachedEpicStatuses(
  opts: BdOptions = {},
): Promise<EpicStatus[]> {
  const cache = projectCache(opts)
  return readThrough(
    cache.epicStatuses,
    (entry) => {
      cache.epicStatuses = entry
    },
    async () => {
      const raw = await runBdJson(['epic', 'status', '--json'], opts)
      return z.array(epicStatusSchema).parse(raw ?? [])
    },
  )
}

/**
 * The inbox activity snapshot — two `bd sql` reads in server mode, or a `bd list` plus a
 * `bd comments` per candidate bead in embedded mode. Retained for activity consumers; the
 * app shell and open-ask inbox use the issue-list cache instead. Cached per project like the
 * rest; `since` is captured at fetch time, which inside
 * one TTL only ever moves the window floor by a few seconds.
 */
export async function getCachedActivitySnapshot(
  projectDir: string,
  viewer: readonly string[],
  since: string,
): Promise<ActivitySnapshot> {
  const cache = projectCache({ cwd: projectDir })
  return readThrough(
    cache.activitySnapshot,
    (entry) => {
      cache.activitySnapshot = entry
    },
    () => fetchActivitySnapshot(projectDir, viewer, since),
  )
}

export async function getCachedMemories(
  opts: BdOptions = {},
): Promise<Memory[]> {
  const cache = projectCache(opts)
  return readThrough(
    cache.memories,
    (entry) => {
      cache.memories = entry
    },
    async () => {
      const raw = await runBdJson(['memories', '--json'], opts)
      const record = z.record(z.string(), z.unknown()).parse(raw ?? {})
      return Object.entries(record)
        .filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        )
        .map(([key, value]) => memorySchema.parse({ key, value }))
        .sort((a, b) => a.key.localeCompare(b.key))
    },
  )
}
