// ABOUTME: Pure tokenizer for comment references in a message body — `comment:<id>` tokens and
// ABOUTME: pm-beads urls carrying a `#comment-<id>` fragment — plus the anchor id both resolve to.

import { maskCode } from './bead-links'

/** One comment a message body points at. */
export interface CommentRef {
  /** The comment's bd id, lowercased. */
  commentId: string
  /** The bead the reference named outright — only a url form knows it. Without one the
   * comment is looked for among the thread's related beads. */
  issueId?: string
}

/** Prefix of the DOM id every comment row in the activity stream carries. */
export const COMMENT_ANCHOR_PREFIX = 'comment-'

/** The DOM id (and url fragment) that anchors one comment in an activity stream. */
export function commentAnchorId(commentId: string): string {
  return `${COMMENT_ANCHOR_PREFIX}${commentId}`
}

/** The comment a location hash points at (`#comment-<id>`), or undefined for any other hash. */
export function commentIdFromHash(
  hash: string | undefined,
): string | undefined {
  const fragment = (hash ?? '').replace(/^#/, '')
  if (!fragment.startsWith(COMMENT_ANCHOR_PREFIX)) return undefined
  const id = fragment.slice(COMMENT_ANCHOR_PREFIX.length)
  return id === '' ? undefined : id.toLowerCase()
}

// bd mints comment ids as UUIDv7 strings, but the shape is bd's to change, so the token is
// matched loosely: alphanumerics, dashes and underscores, long enough that prose like
// "comment:see below" (a space) or "comment:1" cannot be mistaken for one.
const ID_SOURCE = '[0-9a-z][0-9a-z_-]{7,}'

// `comment:<id>` — the form to write in prose. The lookbehind keeps it from firing inside a
// longer word, so `no-comment:xyz` is not a reference.
const TOKEN_PATTERN = new RegExp(`(?<![\\w-])comment:(${ID_SOURCE})`, 'gi')

// A pm-beads deep link that names both the bead and the comment. Host-agnostic like the bead
// tokenizer's own url pattern, and the query (`?project=…`) sits between path and fragment.
const URL_PATTERN = new RegExp(
  `(?<![\\w@])https?://[^\\s/?#]+/(?:issues|projects)/([0-9a-z_-]+(?:\\.[0-9a-z]+)*)` +
    `(?:\\?[^\\s#)>\\]]*)?#${COMMENT_ANCHOR_PREFIX}(${ID_SOURCE})`,
  'gi',
)

/**
 * Every comment reference in a block of markdown source, in source order and deduplicated by
 * comment id — a body that names the same comment twice quotes it once.
 *
 * Code is invisible to this, the same way it is to the bead tokenizer: an id inside backticks
 * is a command someone is meant to run, not a reference. Where one comment is written both
 * ways, the reference that names its bead wins, because that one needs no search to resolve.
 */
export function findCommentRefs(source: string): CommentRef[] {
  const masked = maskCode(source)
  const found: { ref: CommentRef; start: number }[] = []
  for (const match of masked.matchAll(URL_PATTERN)) {
    found.push({
      ref: {
        commentId: match[2].toLowerCase(),
        issueId: match[1].toLowerCase(),
      },
      start: match.index,
    })
  }
  for (const match of masked.matchAll(TOKEN_PATTERN)) {
    found.push({
      ref: { commentId: match[1].toLowerCase() },
      start: match.index,
    })
  }
  found.sort((a, b) => a.start - b.start)

  const byId = new Map<string, CommentRef>()
  for (const { ref } of found) {
    const kept = byId.get(ref.commentId)
    if (kept === undefined) byId.set(ref.commentId, ref)
    else if (kept.issueId === undefined && ref.issueId !== undefined) {
      byId.set(ref.commentId, ref)
    }
  }
  return [...byId.values()]
}
