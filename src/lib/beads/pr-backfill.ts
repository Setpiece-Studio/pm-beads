// ABOUTME: The PR-history backfill's PURE half — reads the project's bead-id prefix, extracts
// ABOUTME: bead ids out of merged PRs with a confidence tier, and plans the review proposals.

import { hasOpenAsk } from './asks'
import { parsePrUrl, prRefUrl } from './pr-link'
import type { SweepAction } from './pr-sweep'

/** How far back a backfill looks by default — half a year of merge history, enough to cover
 * the pile that accumulated before the sweep existed. The user can change it per scan. */
export const BACKFILL_DEFAULT_DAYS = 180

/** Bounds on the user-supplied window. A day is the smallest useful scan; ten years is well
 * past any repo's useful history and keeps a fat-fingered number from timing gh out. */
export const BACKFILL_MIN_DAYS = 1
export const BACKFILL_MAX_DAYS = 3650

const DAY_MS = 24 * 60 * 60 * 1000

/** How strongly a merged PR claims a bead. `high` is the only tier pre-approved in the UI. */
export type BackfillConfidence = 'high' | 'medium' | 'low'

/** Strongest first — the order the review list is sorted in, and the tie-break when one bead
 * is claimed by several PRs. */
const CONFIDENCE_RANK: Record<BackfillConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

/** One merged pull request as `gh pr list --json number,url,title,body,headRefName,mergedAt`
 * reports it. `body` and `headRefName` are what separate a high match from a low one. */
export interface HistoryPr {
  number: number
  url: string
  title: string
  body: string
  headRefName: string
  mergedAt: string
}

/** A bead id found in a PR, with the tier the place it was found earns. */
export interface BeadMatch {
  id: string
  confidence: BackfillConfidence
}

/** The bead fields the plan decides on. A subset of `Issue`, so the run module can build these
 * from a plain `bd list` without this module importing bd's schemas. */
export interface BackfillIssue {
  id: string
  title: string
  status: string
  issue_type: string
  labels?: string[]
  /** The bead's whole metadata map: its `ask.*` keys say whether a person still owes it an
   * answer, which is what keeps it from being auto-closed. */
  metadata?: Record<string, unknown>
  /** The bead's existing pr_url metadata value, when it carries one. */
  prUrl?: string
}

/** What applying a proposal will do. Always both: the link is recorded, then the bead is either
 * closed or merely commented on. Nothing here is applied without an explicit approval. */
export type BackfillActionKind = 'set-pr-url' | 'close' | 'comment-only'

export interface BackfillProposal {
  id: string
  title: string
  status: string
  issue_type: string
  /** Canonical url of the PR that claims this bead. */
  prUrl: string
  prNumber: number
  prTitle: string
  mergedAt: string
  confidence: BackfillConfidence
  actions: [
    'set-pr-url',
    /** `comment-only` for an epic, a bead with an open ask, or one already linked elsewhere. */
    'close' | 'comment-only',
  ]
  /** The pr_url the bead carried before, when this proposal replaces one. Its presence is what
   * makes an otherwise closable bead comment-only: re-pointing a link is not a close. */
  previousPrUrl?: string
}

export interface BackfillPlanInput {
  issues: readonly BackfillIssue[]
  prs: readonly HistoryPr[]
  /** The project's bead-id prefix, e.g. `pm-beads-`. */
  prefix: string
  /** Bead ids a person already dismissed (sidecar `backfill.skipped`). */
  skippedIds?: readonly string[]
}

// A bead id's tail: alphanumerics, plus the dots of a legacy dotted id (`x.1`). Greedy, so at
// a boundary like `pm-beads-1` vs `pm-beads-10` the LONGER id is the one that matches.
const ID_TAIL = '[0-9a-z]+(?:\\.[0-9a-z]+)*'

// Only these three keywords make a match high-confidence. Matched with either whitespace or a
// colon between keyword and id, so `Closes x`, `Closes: x`, and `Closes:x` all count — but
// `Closesx` does not.
const CLOSING_KEYWORDS = 'closes|fixes|resolves'
const KEYWORD_SEPARATOR = '(?:\\s+|\\s*:\\s*)'

/** One project's bead id as a regex source fragment, with no boundary of its own — the piece
 * to embed when the surrounding syntax already delimits the id (`[[<id>]]`, a url path). */
export function beadIdSource(prefix: string): string {
  return `${escapeRegExp(prefix)}${ID_TAIL}`
}

/**
 * The boundary-safe pattern for this project's bead ids anywhere in prose. The lookbehind is
 * the prefix boundary — `pm-beads-1` must not be found inside `old-pm-beads-1` or `xpm-beads-1`
 * — and the greedy tail is what makes `pm-beads-10` match whole rather than as `pm-beads-1`.
 *
 * Shared with the markdown autolinker (`@/lib/bead-links`) so a bead id that the PR backfill
 * would extract from prose is exactly the one the UI turns into a chip.
 */
export function beadIdPattern(prefix: string, flags = 'gi'): RegExp {
  return new RegExp(`(?<![\\w-])${beadIdSource(prefix)}`, flags)
}

/**
 * The bead-id prefix the project's own ids agree on, e.g. `pm-beads-` or `sc-`.
 *
 * Read from the ids rather than configured: bd stores the prefix in its own metadata, but the
 * app already holds the issue list and a prefix that disagrees with the live ids would be
 * worse than useless. The most common answer wins, so one imported foreign id cannot steer it.
 */
export function beadIdPrefix(ids: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const id of ids) {
    const match = new RegExp(`^(.*-)${ID_TAIL}$`, 'i').exec(id.trim())
    if (match === null) continue
    const prefix = match[1].toLowerCase()
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  // Ties break on the alphabetically first prefix so the answer is stable run to run.
  for (const [prefix, count] of [...counts].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (count > bestCount) {
      best = prefix
      bestCount = count
    }
  }
  return best
}

/**
 * Every bead id this PR mentions, each at the strongest tier it earned.
 *
 * - `high` — the body closes it (`Closes`/`Fixes`/`Resolves <id>`, case-insensitive, optional
 *   colon). This is the convention CONTRIBUTING asks for, so it is the one worth trusting.
 * - `medium` — the id is in the PR title or the branch name. Strong habit, weaker promise.
 * - `low` — the id only appears somewhere in the body. Often "see also", so never pre-approved.
 *
 * Ordered by tier then id: the review list must look the same every time it is scanned.
 */
export function extractBeadIds(pr: HistoryPr, prefix: string): BeadMatch[] {
  const closing = idsFromClosingKeywords(pr.body ?? '', prefix)
  const named = new Set([
    ...idsIn(pr.title ?? '', prefix),
    ...idsIn(pr.headRefName ?? '', prefix),
  ])
  const mentioned = idsIn(pr.body ?? '', prefix)

  const tiers = new Map<string, BackfillConfidence>()
  for (const id of mentioned) tiers.set(id, 'low')
  for (const id of named) tiers.set(id, 'medium')
  for (const id of closing) tiers.set(id, 'high')

  return [...tiers]
    .map(([id, confidence]) => ({ id, confidence }))
    .sort(byConfidenceThenId)
}

/**
 * Turn merged PRs into the beads a person should review, one row per bead.
 *
 * Filters, in the order they matter: an id that is not a bead in this project is dropped (PR
 * bodies quote plenty of ids from elsewhere); a closed bead is never proposed, because the
 * backfill exists to close what is still open; a bead already pointing at THIS pull request
 * has nothing to do; and a bead a person already skipped stays skipped.
 *
 * A bead pointing at a DIFFERENT pull request is proposed as an update, never a close — the
 * link is stale, but which PR actually finished the work is a judgment call.
 */
export function planBackfill(input: BackfillPlanInput): BackfillProposal[] {
  const { issues, prs, prefix, skippedIds = [] } = input
  const byId = new Map(issues.map((issue) => [issue.id.toLowerCase(), issue]))
  const skipped = new Set(skippedIds.map((id) => id.toLowerCase()))

  // One row per bead: several PRs can name the same bead, and the review list must not ask
  // the same question twice. The strongest, then most recent, claim wins.
  const best = new Map<string, BackfillProposal>()

  for (const pr of prs) {
    const canonical = canonicalPrUrl(pr.url)
    if (canonical === null) continue
    for (const match of extractBeadIds(pr, prefix)) {
      const issue = byId.get(match.id)
      if (issue === undefined) continue
      if (issue.status === 'closed') continue
      if (skipped.has(issue.id.toLowerCase())) continue

      const existing =
        issue.prUrl === undefined ? null : canonicalPrUrl(issue.prUrl)
      // Already linked to this very PR: nothing about the link to propose.
      if (existing !== null && existing === canonical) continue

      const proposal: BackfillProposal = {
        id: issue.id,
        title: issue.title,
        status: issue.status,
        issue_type: issue.issue_type,
        prUrl: canonical,
        prNumber: pr.number,
        prTitle: pr.title,
        mergedAt: pr.mergedAt,
        confidence: match.confidence,
        actions: [
          'set-pr-url',
          existing !== null || awaitsPerson(issue) ? 'comment-only' : 'close',
        ],
      }
      if (issue.prUrl !== undefined) proposal.previousPrUrl = issue.prUrl

      const incumbent = best.get(issue.id)
      if (incumbent === undefined || beatsIncumbent(proposal, incumbent)) {
        best.set(issue.id, proposal)
      }
    }
  }

  return [...best.values()].sort(byConfidenceThenMergedAt)
}

/**
 * The sweep action one approved proposal becomes — the same shape the merged-PR sweep applies,
 * so the backfill writes through exactly one code path (pr-sweep-run's applySweepAction).
 *
 * The comment says "backfilled from PR history" and names the tier: a bead closed from a
 * medium-confidence branch-name guess must be traceable to that guess later.
 */
export function backfillAction(proposal: BackfillProposal): SweepAction {
  const suffix = `backfilled from PR history (${proposal.confidence} confidence)`
  const head = `PR #${proposal.prNumber} merged ${proposal.prUrl}`
  if (proposal.actions[1] === 'close') {
    return {
      id: proposal.id,
      prUrl: proposal.prUrl,
      prNumber: proposal.prNumber,
      mergedAt: proposal.mergedAt,
      kind: 'close',
      comment: `Closed: ${head} — ${suffix}`,
      closeReason: `PR #${proposal.prNumber} merged`,
    }
  }
  const why =
    proposal.previousPrUrl === undefined
      ? 'not auto-closed (epic / open ask)'
      : `pr_url updated from ${proposal.previousPrUrl}`
  return {
    id: proposal.id,
    prUrl: proposal.prUrl,
    prNumber: proposal.prNumber,
    mergedAt: proposal.mergedAt,
    kind: 'comment-only',
    comment: `${head} — ${suffix}; ${why}`,
  }
}

/** The instant a scan searches from. Clamped at both ends: a junk or absent value falls back
 * to the default window, and neither 0 nor 100000 days reaches gh. */
export function backfillSince(daysBack: number | undefined, now: Date): Date {
  const days =
    daysBack === undefined || !Number.isFinite(daysBack)
      ? BACKFILL_DEFAULT_DAYS
      : Math.min(
          BACKFILL_MAX_DAYS,
          Math.max(BACKFILL_MIN_DAYS, Math.floor(daysBack)),
        )
  return new Date(now.getTime() - days * DAY_MS)
}

/** Epics roll up children rather than being worked directly, and an unanswered `ask.*` says a
 * person still owes the bead something — the same rule the sweep applies (CONCEPTS.md). */
function awaitsPerson(issue: BackfillIssue): boolean {
  if (issue.issue_type === 'epic') return true
  return hasOpenAsk(issue.metadata)
}

/** Ids named by a closing keyword in the body — the high-confidence tier. */
function idsFromClosingKeywords(text: string, prefix: string): Set<string> {
  const pattern = new RegExp(
    `\\b(?:${CLOSING_KEYWORDS})${KEYWORD_SEPARATOR}(${beadIdSource(prefix)})`,
    'gi',
  )
  const found = new Set<string>()
  for (const match of text.matchAll(pattern)) found.add(match[1].toLowerCase())
  return found
}

/** Every bead id of this project's prefix anywhere in the text. */
function idsIn(text: string, prefix: string): Set<string> {
  const pattern = beadIdPattern(prefix)
  const found = new Set<string>()
  for (const match of text.matchAll(pattern)) found.add(match[0].toLowerCase())
  return found
}

/** A pr_url reduced to the one string form two urls for the same PR always share, so a stored
 * `/pull/42/files` still matches what gh reports. Null when it is not a PR url at all. */
function canonicalPrUrl(url: string): string | null {
  const ref = parsePrUrl(url)
  if (ref === null) return null
  return prRefUrl({
    owner: ref.owner.toLowerCase(),
    repo: ref.repo.toLowerCase(),
    number: ref.number,
  })
}

/** A stronger claim wins; at equal strength, the more recent merge does. */
function beatsIncumbent(
  candidate: BackfillProposal,
  incumbent: BackfillProposal,
): boolean {
  const byTier =
    CONFIDENCE_RANK[candidate.confidence] -
    CONFIDENCE_RANK[incumbent.confidence]
  if (byTier !== 0) return byTier < 0
  return candidate.mergedAt > incumbent.mergedAt
}

function byConfidenceThenId(a: BeadMatch, b: BeadMatch): number {
  const byTier = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
  return byTier !== 0 ? byTier : a.id.localeCompare(b.id)
}

/** Review-list order: strongest claims first, newest merges first inside a tier, then id so
 * two scans of the same history render identically. */
function byConfidenceThenMergedAt(
  a: BackfillProposal,
  b: BackfillProposal,
): number {
  const byTier = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
  if (byTier !== 0) return byTier
  if (a.mergedAt !== b.mergedAt) return a.mergedAt < b.mergedAt ? 1 : -1
  return a.id.localeCompare(b.id)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
