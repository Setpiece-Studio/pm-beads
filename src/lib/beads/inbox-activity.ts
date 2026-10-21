// ABOUTME: Inbox activity items — comments on the viewer's beads, beads carrying an open ask,
// ABOUTME: and @mentions. Pure selection over a snapshot, fetched by bd sql with a list fallback.

import { z } from 'zod'
import {
  ASK_METADATA_PREFIX,
  type OpenAskSummary,
  openAskSummary,
} from './asks'
import { type BdOptions, runBdJson } from './cli'
import { humanAddresses, isHumanAddress } from './messages'
import {
  type Comment,
  commentSchema,
  issueSchema,
  metadataSchema,
} from './types'

/** The three reasons something lands in the activity feed, most urgent first. A comment that
 * qualifies under more than one reason is emitted ONCE, under the highest. */
export const activityKinds = ['ask', 'mention', 'comment'] as const

export type ActivityKind = (typeof activityKinds)[number]

/** How far back the feed reaches when the project's sidecar has no `inbox.activitySince`.
 * Bounds both the bd sql window and the fallback's per-issue comment reads. */
export const ACTIVITY_WINDOW_DAYS = 30

/** Most items the feed holds. Read state is capped to match (inbox-store.ts), so an item that
 * falls off the end of the feed also falls out of the read set rather than stranding it. */
export const ACTIVITY_ITEM_CAP = 500

/** Most comments one bd sql read returns. Well above the cap so ordering is decided by the
 * feed, not by where the query stopped. */
const SQL_COMMENT_LIMIT = 2000

/** Most issues the CLI fallback will read comments for in one pass. Each is a serialized bd
 * spawn (~300–500 ms in embedded mode), so this is the ceiling on how slow the degraded path
 * gets; beyond it the snapshot reports `truncated`. */
export const FALLBACK_COMMENT_READ_CAP = 60

const DAY_MS = 24 * 60 * 60 * 1000

/** The issue fields an activity item needs. Deliberately narrower than `Issue`: both fetch
 * paths can produce exactly this, so the pure filter below never sees which one ran. */
export interface ActivityIssue {
  id: string
  title: string
  status: string
  createdBy?: string
  assignee?: string
  /** Used as an `ask` item's text when the bead has no comments yet. */
  description: string
  createdAt: string
  /** Carries at least one `ask.*` nobody has answered — derived from the bead's own metadata,
   * never asserted beside it, so answering the last ask is what takes the bead out of the feed. */
  hasOpenAsk: boolean
  /** Soonest `default_at` among those open asks, when any of them carries one. */
  askDefaultAt?: string
}

/** Everything the pure selection reads, plus how it was obtained. */
export interface ActivitySnapshot {
  issues: ActivityIssue[]
  comments: Comment[]
  /** 'sql' is the server-mode path; 'cli' is the embedded fallback. */
  source: 'sql' | 'cli'
  /** True when the fallback hit FALLBACK_COMMENT_READ_CAP and stopped short. */
  truncated: boolean
}

/** One row of the Activity tab. */
export interface ActivityItem {
  kind: ActivityKind
  /**
   * Stable across reloads so read state can key on it: `comment:<id>` or `ask:<issueId>`.
   *
   * The `ask:` prefix deliberately replaces the `human:` one the label-driven feed used. The
   * feed's membership changes wholesale with this filter — a bead that was in it by label and
   * carries no ask metadata leaves entirely — so its old `human:<issueId>` read id is orphaned
   * whatever prefix we pick, and orphans age out of the sidecar's capped list on their own.
   * A bead that was read as a label item AND has an open ask resurfaces once, which is the
   * right answer: the ask is a question the label never stood for.
   */
  id: string
  issueId: string
  issueTitle: string
  issueStatus: string
  actor: string
  text: string
  createdAt: string
  /** `ask` items only: the soonest `default_at` among the bead's open asks, which is what the
   * feed orders them by. Absent when no open ask carries one. */
  dueAt?: string
}

export interface SelectActivityOptions {
  /** Every address that counts as the viewer (PM_BEADS_USER aliases). */
  viewer: readonly string[]
  /** ISO instant; comments older than this are out of the feed. */
  since: string
}

/** The default window floor: ACTIVITY_WINDOW_DAYS before `now`. */
export function activityWindowStart(now: Date = new Date()): string {
  return new Date(now.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS).toISOString()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether a comment addresses the viewer with `@<alias>`. Every PM_BEADS_USER alias counts,
 * matched case-insensitively and stopped at a word boundary so `@benjamin` is not `@ben`.
 * A multi-word alias ("Ben Harper") matches literally — agents that write it do so verbatim.
 */
export function mentionsViewer(
  text: string,
  viewer: readonly string[],
): boolean {
  return viewer.some((alias) => {
    const trimmed = alias.trim()
    if (trimmed === '') return false
    return new RegExp(
      `@${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}_-])`,
      'iu',
    ).test(text)
  })
}

/** Comments on an issue, oldest first. bd hands them over in insertion order already; the
 * explicit sort keeps the fetch paths interchangeable. */
function commentsFor(comments: readonly Comment[], issueId: string): Comment[] {
  return comments
    .filter((comment) => comment.issue_id === issueId)
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    )
}

/**
 * The feed from one snapshot.
 *
 * Three sources, in precedence order — a comment that qualifies under more than one is
 * emitted once, under the highest:
 *
 * 1. `ask` — an OPEN bead carrying an unanswered `ask.*`. One item per bead (not per ask and
 *    not per comment), so several questions and a long back-and-forth stay a single row. It
 *    ignores the window floor: an open ask does not age out of the inbox, it gets answered.
 * 2. `mention` — a comment containing `@<viewer alias>`, on any bead.
 * 3. `comment` — a comment by someone else on a bead the viewer created or is assigned.
 *
 * Comments the viewer wrote never appear: the feed is what is waiting on Ben.
 *
 * Ordering: open asks lead, soonest `default_at` first — the ask that will decide itself first
 * is the one to answer first — so the ACTIVITY_ITEM_CAP can never drop an ask in favour of
 * chatter. An ask with no `default_at` has no deadline to compare, so rather than inventing one
 * it sorts after every dated ask and among its own kind newest first, which is how the feed
 * ordered it before there were deadlines at all. Everything else follows, newest first.
 */
export function selectActivityItems(
  snapshot: ActivitySnapshot,
  { viewer, since }: SelectActivityOptions,
): ActivityItem[] {
  const byId = new Map(snapshot.issues.map((issue) => [issue.id, issue]))
  const items: ActivityItem[] = []

  for (const issue of snapshot.issues) {
    if (!issue.hasOpenAsk || issue.status === 'closed') continue
    // The last comment is what the bead is currently asking; with none, the bead itself is.
    const last = commentsFor(snapshot.comments, issue.id).at(-1)
    const item: ActivityItem = {
      kind: 'ask',
      id: `ask:${issue.id}`,
      issueId: issue.id,
      issueTitle: issue.title,
      issueStatus: issue.status,
      actor: last?.author ?? issue.createdBy ?? '',
      text: last?.text ?? issue.description,
      createdAt: last?.created_at ?? issue.createdAt,
    }
    if (issue.askDefaultAt !== undefined) item.dueAt = issue.askDefaultAt
    items.push(item)
  }

  for (const comment of snapshot.comments) {
    if (comment.created_at < since) continue
    if (isHumanAddress(comment.author, viewer)) continue
    const issue = byId.get(comment.issue_id)
    if (issue === undefined) continue
    // The bead already has an `ask` item standing in for its whole thread.
    if (issue.hasOpenAsk && issue.status !== 'closed') continue

    const mention = mentionsViewer(comment.text, viewer)
    const mine =
      isHumanAddress(issue.createdBy, viewer) ||
      isHumanAddress(issue.assignee, viewer)
    if (!mention && !mine) continue

    items.push({
      kind: mention ? 'mention' : 'comment',
      id: `comment:${comment.id}`,
      issueId: issue.id,
      issueTitle: issue.title,
      issueStatus: issue.status,
      actor: comment.author,
      text: comment.text,
      createdAt: comment.created_at,
    })
  }

  return items.sort(byUrgency).slice(0, ACTIVITY_ITEM_CAP)
}

/** Which band an item sorts in: dated asks, then undated asks, then everything else. */
function urgencyBand(item: ActivityItem): number {
  if (item.kind !== 'ask') return 2
  return item.dueAt === undefined ? 1 : 0
}

/** Soonest deadline first inside the dated band; newest first everywhere else; item id last so
 * two runs over the same snapshot produce the same feed. */
function byUrgency(a: ActivityItem, b: ActivityItem): number {
  const band = urgencyBand(a) - urgencyBand(b)
  if (band !== 0) return band
  if (a.dueAt !== undefined && b.dueAt !== undefined) {
    const due = a.dueAt.localeCompare(b.dueAt)
    if (due !== 0) return due
  }
  return b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
}

/**
 * The two `bd sql` reads behind the server-mode path, exported so an integration test can run
 * them against a real project and fail loudly when bd's internal schema drifts.
 *
 * `since` is the only interpolated value and is always an ISO instant this module produced —
 * no caller-supplied text reaches the query, so there is nothing to escape. The viewer's
 * aliases deliberately stay OUT of SQL: every comment they could match is already inside the
 * window, so the filtering is done in TypeScript where it is testable.
 *
 * So is the ask state. bd stores an issue's metadata as one JSON document in a text column, so
 * SQL can only spot the `ask.` key prefix; whether any of those asks is still OPEN is decided
 * by `openAskSummary` over the parsed document. The LIKE is therefore a candidate filter, not
 * the filter — it may over-select (a bead whose asks are all answered) and never under-selects.
 */
export function activitySnapshotQueries(since: string): {
  issues: string
  comments: string
} {
  // Metadata keys are JSON object keys, so an ask always appears as the literal `"ask.`.
  const askIds = `SELECT id FROM issues WHERE metadata LIKE '%"${ASK_METADATA_PREFIX}%'`
  return {
    issues: [
      'SELECT i.id AS id, i.title AS title, i.status AS status,',
      'i.created_by AS created_by, i.assignee AS assignee,',
      "IFNULL(i.description, '') AS description, i.created_at AS created_at,",
      "IFNULL(i.metadata, '') AS metadata",
      'FROM issues i',
      `WHERE i.id IN (${askIds})`,
      `OR i.id IN (SELECT issue_id FROM comments WHERE created_at >= '${since}')`,
    ].join(' '),
    comments: [
      'SELECT id AS id, issue_id AS issue_id, author AS author,',
      'text AS text, created_at AS created_at',
      'FROM comments',
      `WHERE created_at >= '${since}' OR issue_id IN (${askIds})`,
      `ORDER BY created_at DESC LIMIT ${SQL_COMMENT_LIMIT}`,
    ].join(' '),
  }
}

/** `bd sql --json` hands back a flat array of row objects keyed by the selected column names;
 * a NULL column arrives as JSON null, and a boolean expression as 0/1. */
const sqlIssueRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  created_by: z.string().nullish(),
  assignee: z.string().nullish(),
  description: z.string().nullish(),
  created_at: z.string(),
  /** The raw metadata document, as text. Parsed tolerantly by `parseSqlMetadata`: a bead
   * with unreadable metadata must still reach the feed. */
  metadata: z.string().nullish(),
})

/**
 * The metadata document a `bd sql` row carries, in the shape `parseAsks` reads.
 *
 * Failing soft is the whole point: a document that is not an object, or not JSON at all, yields
 * no asks rather than taking the inbox down with it. Preserve nested values so SQL and list
 * reads interpret structured asks identically.
 */
function parseSqlMetadata(
  raw: string | null | undefined,
): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  let document: unknown
  try {
    document = JSON.parse(raw)
  } catch {
    return undefined
  }
  const parsed = metadataSchema.safeParse(document)
  return parsed.success ? parsed.data : undefined
}

/** The two ask fields an `ActivityIssue` carries, from one bead's metadata. */
function askFields(
  metadata: Record<string, unknown> | undefined,
): Pick<ActivityIssue, 'hasOpenAsk' | 'askDefaultAt'> {
  const summary: OpenAskSummary = openAskSummary(metadata)
  return summary.defaultAt === undefined
    ? { hasOpenAsk: summary.open }
    : { hasOpenAsk: summary.open, askDefaultAt: summary.defaultAt }
}

const sqlCommentRowSchema = z.object({
  id: z.string(),
  issue_id: z.string(),
  author: z.string().nullish(),
  text: z.string().nullish(),
  created_at: z.string(),
})

function blank(value: string | null | undefined): string {
  return value ?? ''
}

function optional(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value === ''
    ? undefined
    : value
}

/** Server-mode path: two `bd sql` reads. Throws when the project is embedded (bd refuses
 * `bd sql` outright) or the schema has drifted under the queries. */
export async function fetchActivitySnapshotViaSql(
  since: string,
  opts: BdOptions = {},
): Promise<ActivitySnapshot> {
  const queries = activitySnapshotQueries(since)
  const issueRows = z
    .array(sqlIssueRowSchema)
    .parse((await runBdJson(['sql', queries.issues, '--json'], opts)) ?? [])
  const commentRows = z
    .array(sqlCommentRowSchema)
    .parse((await runBdJson(['sql', queries.comments, '--json'], opts)) ?? [])

  return {
    issues: issueRows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      createdBy: optional(row.created_by),
      assignee: optional(row.assignee),
      description: blank(row.description),
      createdAt: row.created_at,
      ...askFields(parseSqlMetadata(row.metadata)),
    })),
    comments: commentRows.map((row) => ({
      id: row.id,
      issue_id: row.issue_id,
      author: blank(row.author),
      text: blank(row.text),
      created_at: row.created_at,
    })),
    source: 'sql',
    truncated: false,
  }
}

/**
 * Embedded fallback: one `bd list --json --all --limit 0`, then `bd comments` per candidate.
 *
 * The candidate set is everything that can produce an item: beads carrying an open ask, beads
 * the viewer created or is assigned, and beads touched since the window floor. That last clause
 * is what carries @mentions — bd does NOT bump `updated_at` when a comment is added, so a mention
 * on a bead the viewer is unrelated to and that has not been edited since the floor is invisible
 * to this path. Server-mode projects (`bd sql`) have no such gap; embedded is the degraded path.
 *
 * `bd list --json` returns metadata as a real object, so unlike the SQL path there is nothing
 * to parse out of a text column first.
 */
export async function fetchActivitySnapshotViaCli(
  since: string,
  viewer: readonly string[],
  opts: BdOptions = {},
): Promise<ActivitySnapshot> {
  const raw = await runBdJson(['list', '--json', '--all', '--limit', '0'], opts)
  const issues = z.array(issueSchema).parse(raw ?? [])

  const openAsks = new Map(
    issues.map((issue) => [issue.id, askFields(issue.metadata)]),
  )
  const hasOpenAsk = (id: string): boolean =>
    openAsks.get(id)?.hasOpenAsk === true

  const snapshotIssues: ActivityIssue[] = issues.map((issue) => ({
    id: issue.id,
    title: issue.title,
    status: issue.status,
    createdBy: issue.created_by,
    assignee: issue.assignee,
    description: issue.description ?? '',
    createdAt: issue.created_at,
    ...(openAsks.get(issue.id) ?? { hasOpenAsk: false }),
  }))

  const candidates = issues
    .filter((issue) => (issue.comment_count ?? 0) > 0)
    .filter(
      (issue) =>
        hasOpenAsk(issue.id) ||
        isHumanAddress(issue.created_by, viewer) ||
        isHumanAddress(issue.assignee, viewer) ||
        issue.updated_at >= since,
    )
    // Newest activity first, so a truncated pass keeps what matters most.
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  const read = candidates.slice(0, FALLBACK_COMMENT_READ_CAP)
  const comments: Comment[] = []
  for (const issue of read) {
    // Serial: bd is single-writer and cli.ts serializes anyway; a parallel map would only
    // queue behind the same mutex while holding more memory.
    const rows = await runBdJson(['comments', issue.id, '--json'], opts)
    comments.push(...z.array(commentSchema).parse(rows ?? []))
  }

  return {
    issues: snapshotIssues,
    comments,
    source: 'cli',
    truncated: candidates.length > read.length,
  }
}

/** True when bd refused `bd sql` because the project is embedded rather than in server mode. */
function isEmbeddedSqlRefusal(error: unknown): boolean {
  const parts = [
    error instanceof Error ? error.message : String(error),
    typeof (error as { stderr?: unknown })?.stderr === 'string'
      ? (error as { stderr: string }).stderr
      : '',
  ]
  return parts.some((part) => /not yet supported in embedded mode/i.test(part))
}

/** Projects whose bd refused `bd sql` for being embedded. A project's backend does not change
 * under a running server, so the refusal is remembered instead of paid for on every read. */
const embeddedProjects = new Set<string>()

export function clearActivitySourceCacheForTest(): void {
  embeddedProjects.clear()
}

/** The snapshot, by whichever path this project supports. A `bd sql` failure that is NOT the
 * embedded refusal (schema drift, a stopped server) still falls back rather than breaking the
 * inbox — but it is not remembered, so the fast path is retried next read. */
export async function fetchActivitySnapshot(
  projectDir: string,
  viewer: readonly string[],
  since: string,
): Promise<ActivitySnapshot> {
  const opts: BdOptions = { cwd: projectDir }
  if (!embeddedProjects.has(projectDir)) {
    try {
      return await fetchActivitySnapshotViaSql(since, opts)
    } catch (error) {
      if (isEmbeddedSqlRefusal(error)) embeddedProjects.add(projectDir)
      else
        console.warn(
          `[pm-beads] activity: bd sql failed for ${projectDir}, falling back to bd list: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
    }
  }
  return fetchActivitySnapshotViaCli(since, viewer, opts)
}

export interface ListActivityOptions {
  /** ISO window floor. Defaults to ACTIVITY_WINDOW_DAYS ago. */
  since?: string
}

export interface ActivityFeed {
  items: ActivityItem[]
  source: ActivitySnapshot['source']
  truncated: boolean
  /** The floor actually used, so the caller can show how far back the feed reaches. */
  since: string
}

/** The Activity tab's feed for one project. */
export async function listActivityItems(
  projectDir: string,
  viewer: readonly string[] = humanAddresses(),
  options: ListActivityOptions = {},
): Promise<ActivityFeed> {
  const since = options.since ?? activityWindowStart()
  const snapshot = await fetchActivitySnapshot(projectDir, viewer, since)
  return {
    items: selectActivityItems(snapshot, { viewer, since }),
    source: snapshot.source,
    truncated: snapshot.truncated,
    since,
  }
}
