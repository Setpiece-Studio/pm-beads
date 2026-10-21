// ABOUTME: Live pull-request state for a linked pr_url, read by shelling to `gh pr view --json`.
// ABOUTME: Deliberately outside the bd mutex (it is a GitHub call), short-cached, and fails soft.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { parsePrUrl } from './pr-link'

const execFileAsync = promisify(execFile)

/** How a PR renders in the rail's badge. `unknown` is the soft-failure value: gh missing,
 * unauthenticated, offline, or the url pointing at something gh can't resolve. */
export const prStates = [
  'open',
  'draft',
  'merged',
  'closed',
  'unknown',
] as const

export type PrState = (typeof prStates)[number]

export interface PrStatus {
  /** Echoed back so a client holding several statuses can key them. Absent only when the
   * gh payload carried no url and the caller passed none (mapPrView on a bare payload). */
  url?: string
  number?: number
  title?: string
  state: PrState
}

/** gh's own field names. Every field is optional: gh's schema is not ours to depend on, and a
 * payload missing one should degrade the badge, not throw. */
const prViewSchema = z.object({
  number: z.number().int().optional(),
  title: z.string().optional(),
  state: z.string().optional(),
  isDraft: z.boolean().optional(),
  mergedAt: z.string().nullish(),
  url: z.string().optional(),
})

/** Wall-clock cap on one gh call. It runs off the bd mutex, so a hung gh only stalls the
 * rail row that asked for it — but it must still end. */
const GH_TIMEOUT_MS = 10_000

/** How long a status is reused. Long enough that a rail re-render (or several beads pointing
 * at the same PR) costs one gh call; short enough that a merge shows up while you watch. */
const PR_STATE_TTL_MS = 60_000

interface CacheEntry {
  value?: PrStatus
  expiresAt: number
  loading?: Promise<PrStatus>
}

const cache = new Map<string, CacheEntry>()

export function clearPrStateCacheForTest(): void {
  cache.clear()
}

/** Map one `gh pr view --json ...` payload onto the badge's state. A merged PR reports
 * state MERGED, but a merged-then-referenced PR can also arrive as CLOSED with a mergedAt,
 * so mergedAt wins over the state string. Draft is state OPEN plus isDraft. */
export function mapPrView(raw: unknown): PrStatus {
  const parsed = prViewSchema.safeParse(raw)
  if (!parsed.success) return { state: 'unknown' }
  const view = parsed.data
  const status: PrStatus = { state: prStateOf(view) }
  if (view.url !== undefined) status.url = view.url
  if (view.number !== undefined) status.number = view.number
  if (view.title !== undefined) status.title = view.title
  return status
}

function prStateOf(view: z.infer<typeof prViewSchema>): PrState {
  if (view.mergedAt !== undefined && view.mergedAt !== null) return 'merged'
  switch (view.state?.toUpperCase()) {
    case 'MERGED':
      return 'merged'
    case 'CLOSED':
      return 'closed'
    case 'OPEN':
      return view.isDraft === true ? 'draft' : 'open'
    default:
      return 'unknown'
  }
}

/** Injected gh reader, so the cache and mapping are testable without a GitHub round trip. */
export interface PrStateDeps {
  gh: (url: string, cwd?: string) => Promise<string>
}

const defaultDeps: PrStateDeps = { gh: runGhPrView }

async function runGhPrView(url: string, cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'gh',
    ['pr', 'view', url, '--json', 'number,title,state,mergedAt,isDraft,url'],
    { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
  )
  return stdout
}

/**
 * PR state for a url, cached ~60s per url. Never throws: a gh failure, a non-JSON payload, or a
 * url that isn't a GitHub PR all resolve to `unknown` so the rail still renders the link. The
 * failure is cached for the same window — a broken gh must not be re-spawned on every render.
 */
export async function readPrState(
  url: string,
  deps: PrStateDeps = defaultDeps,
  cwd?: string,
): Promise<PrStatus> {
  const now = Date.now()
  const entry = cache.get(url)
  if (entry?.value !== undefined && entry.expiresAt > now) return entry.value
  if (entry?.loading) return entry.loading

  const next: CacheEntry = { expiresAt: 0 }
  next.loading = loadPrState(url, deps, cwd)
    .then((value) => {
      next.value = value
      next.expiresAt = Date.now() + PR_STATE_TTL_MS
      return value
    })
    .finally(() => {
      next.loading = undefined
    })
  cache.set(url, next)
  return next.loading
}

async function loadPrState(
  url: string,
  deps: PrStateDeps,
  cwd?: string,
): Promise<PrStatus> {
  if (parsePrUrl(url) === null) return { url, state: 'unknown' }
  try {
    const stdout = await deps.gh(url, cwd)
    return { ...mapPrView(JSON.parse(stdout)), url }
  } catch {
    return { url, state: 'unknown' }
  }
}

/** The server-fn entry point: read PR state for a url, optionally from inside a project dir so
 * gh picks up that repo's own configuration. */
export function getPrState(url: string, cwd?: string): Promise<PrStatus> {
  return readPrState(url, defaultDeps, cwd)
}
