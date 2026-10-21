// ABOUTME: The pr_url convention's PURE helpers — parse a GitHub PR url, parse an origin remote,
// ABOUTME: and resolve typed input against one. Kept free of node imports: the rail imports it.

import type { Issue, ShowIssue } from './types'

/** Flat issue-metadata key holding the bead's LATEST pull request url. See CONCEPTS.md. */
export const PR_URL_METADATA_KEY = 'pr_url'

/** A pull request identified the way GitHub does: owner, repo, and number. */
export interface PrRef {
  owner: string
  repo: string
  number: number
}

// One github.com PR url, tolerating http/https, a www host, a deep path (/files), a query,
// a fragment, and a trailing slash — all forms that come off the clipboard.
const PR_URL_PATTERN =
  /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]|$)/i

// https://github.com/o/r(.git) and ssh://git@github.com/o/r(.git) — the slash-separated forms.
const HTTPS_REMOTE_PATTERN =
  /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i

// git@github.com:o/r(.git) — git's scp-style form, which has no scheme and a colon separator.
const SCP_REMOTE_PATTERN =
  /^(?:[^@\s]+@)?github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i

/** Parse a full GitHub PR url. Null when it is not one (an issue url, another host, junk). */
export function parsePrUrl(url: string): PrRef | null {
  const match = PR_URL_PATTERN.exec(url.trim())
  if (!match) return null
  return { owner: match[1], repo: match[2], number: Number(match[3]) }
}

/** Parse a bare PR reference — "42" or "#42". Null for anything else, including 0 and decimals. */
export function parsePrNumber(input: string): number | null {
  const match = /^#?(\d+)$/.exec(input.trim())
  if (!match) return null
  const number = Number(match[1])
  return number > 0 ? number : null
}

/** Parse a git remote url into the GitHub repo it points at. Null for non-GitHub remotes. */
export function parseGitRemoteUrl(
  remote: string,
): Omit<PrRef, 'number'> | null {
  const trimmed = remote.trim()
  const match =
    HTTPS_REMOTE_PATTERN.exec(trimmed) ?? SCP_REMOTE_PATTERN.exec(trimmed)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

/** The canonical url for a ref — what gets stored in pr_url regardless of what was pasted. */
export function prRefUrl(ref: PrRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`
}

/**
 * Resolve what someone typed into a PR ref. A full url resolves on its own; a bare number or
 * "#N" needs the project's origin remote to say WHICH repo it means. Throws with a message
 * meant to be rendered inline next to the input.
 */
export function resolvePrRefWith(
  input: string,
  originUrl: string | null,
): PrRef {
  const trimmed = input.trim()
  const fromUrl = parsePrUrl(trimmed)
  if (fromUrl) return fromUrl

  const number = parsePrNumber(trimmed)
  if (number === null) {
    throw new Error(`Not a pull request url or number: ${trimmed || '(empty)'}`)
  }
  const repo = originUrl === null ? null : parseGitRemoteUrl(originUrl)
  if (repo === null) {
    throw new Error(
      `#${number} needs a GitHub origin remote to resolve against; paste the full pull request url instead.`,
    )
  }
  return { ...repo, number }
}

/** True when resolvePrRefWith could resolve this input given a remote — a cheap client-side
 * check so the rail can reject obvious junk without a server round trip. */
export function isPossiblePrRef(input: string): boolean {
  const trimmed = input.trim()
  return parsePrUrl(trimmed) !== null || parsePrNumber(trimmed) !== null
}

/** The bead's linked PR url, or undefined when it carries none. Metadata values are typed, so a
 * pr_url that somehow isn't a string is treated as absent rather than rendered. */
export function prUrlOf(issue: Issue | ShowIssue): string | undefined {
  const value = issue.metadata?.[PR_URL_METADATA_KEY]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Display fallback when gh has no title for the PR: "owner/repo#N", or the url as-is. */
export function shortPrLabel(url: string): string {
  const ref = parsePrUrl(url)
  return ref === null ? url : `${ref.owner}/${ref.repo}#${ref.number}`
}
