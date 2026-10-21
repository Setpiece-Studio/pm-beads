// ABOUTME: Pure tokenizer for bead references in markdown — bare ids of the project's prefix,
// ABOUTME: explicit [[id]] syntax, and pm-beads /issues//projects/ urls, never inside code.

import { beadIdPattern, beadIdSource } from './beads/pr-backfill'

/** How a reference was written. Only `url` carries its own answer about epic-ness. */
export type BeadRefKind = 'bare' | 'wiki' | 'url'

/** One bead reference found in a string, with the span it occupies in that string. */
export interface BeadRef {
  /** The bead id, lowercased — the form bd stores and every route param uses. */
  id: string
  /** Offsets of the WHOLE reference: `[[` and `]]` included, query string included. */
  start: number
  end: number
  kind: BeadRefKind
  /** True when the reference itself says the bead is an epic — i.e. a `/projects/` url. */
  epic: boolean
}

// A pm-beads deep link on any host: the dev server's own origin, a tunnelled one, whatever a
// person pasted. The path is what identifies it, so the host is deliberately unconstrained.
// An optional query (`?project=/Users/...`) and an optional fragment (`#comment-<id>`, the
// deep link to one comment in the bead's activity stream) are both swallowed into the match,
// so neither renders as trailing text beside the chip.
const BEAD_URL_PATTERN =
  /(?<![\w@])https?:\/\/[^\s/?#]+\/(issues|projects)\/([0-9a-z_-]+(?:\.[0-9a-z]+)*)(?:\?[^\s#)>\]]*)?(?:#[^\s)>\]]*)?/gi

/**
 * Every bead reference in a block of markdown SOURCE, in source order.
 *
 * Code is invisible to this: fenced blocks and inline code spans are blanked before the scan,
 * so `bd show pm-beads-1` inside backticks stays a command rather than becoming a link. What
 * it cannot see is an indented (four-space) code block — the markdown renderer's own AST is
 * what excludes those, via `findBeadRefsInText` on text nodes only.
 *
 * `prefix` is the project's bead-id prefix (`beadIdPrefix` over the loaded ids). Without one,
 * bare ids and `[[id]]` are unresolvable and only urls — which name their bead outright — are
 * found.
 */
export function findBeadRefs(source: string, prefix: string | null): BeadRef[] {
  // The mask preserves length and line breaks, so every span still indexes the original source.
  return findBeadRefsInText(maskCode(source), prefix)
}

/**
 * The same scan without the code masking, for a string already known to hold no code — a
 * markdown `text` node, where the AST has already separated code out.
 */
export function findBeadRefsInText(
  text: string,
  prefix: string | null,
): BeadRef[] {
  const found: BeadRef[] = [...urlRefs(text)]
  if (prefix !== null) {
    found.push(...wikiRefs(text, prefix), ...bareRefs(text, prefix))
  }

  // Longest-wins at a shared start, then first-wins: a bare id inside `[[…]]` or inside a url
  // is the same reference written once, and must be reported once.
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: BeadRef[] = []
  let consumedTo = -1
  for (const ref of found) {
    if (ref.start < consumedTo) continue
    kept.push(ref)
    consumedTo = ref.end
  }
  return kept
}

/**
 * The bead a pm-beads deep link points at, or null when the url is not one. `/projects/<id>`
 * is an epic's canonical home, so that path is itself the epic answer.
 */
export function parseBeadUrl(
  url: string,
): { id: string; epic: boolean } | null {
  const trimmed = url.trim()
  const match = new RegExp(BEAD_URL_PATTERN.source, 'i').exec(trimmed)
  // The whole string has to be the link — `<url> and more` is prose, not a reference.
  if (
    match === null ||
    match.index !== 0 ||
    match[0].length !== trimmed.length
  ) {
    return null
  }
  return {
    id: match[2].toLowerCase(),
    epic: match[1].toLowerCase() === 'projects',
  }
}

function urlRefs(text: string): BeadRef[] {
  const refs: BeadRef[] = []
  for (const match of text.matchAll(BEAD_URL_PATTERN)) {
    refs.push({
      id: match[2].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
      kind: 'url',
      epic: match[1].toLowerCase() === 'projects',
    })
  }
  return refs
}

/** `[[<id>]]` — the explicit form, for prose where a bare id would read badly. The id still
 * has to be one of this project's: `[[anything]]` is not a bead link. */
function wikiRefs(text: string, prefix: string): BeadRef[] {
  const pattern = new RegExp(`\\[\\[(${beadIdSource(prefix)})\\]\\]`, 'gi')
  const refs: BeadRef[] = []
  for (const match of text.matchAll(pattern)) {
    refs.push({
      id: match[1].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
      kind: 'wiki',
      epic: false,
    })
  }
  return refs
}

function bareRefs(text: string, prefix: string): BeadRef[] {
  const refs: BeadRef[] = []
  for (const match of text.matchAll(beadIdPattern(prefix))) {
    refs.push({
      id: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
      kind: 'bare',
      epic: false,
    })
  }
  return refs
}

/**
 * The source with every code span and fenced block replaced by spaces of the same length, so
 * offsets into the result are still offsets into the original. Exported for the comment-ref
 * tokenizer, which has to ignore code for exactly the same reason.
 */
export function maskCode(source: string): string {
  return maskInlineCode(maskFences(source))
}

// A fence opens on a line of three or more backticks or tildes (up to three leading spaces)
// and closes on a line of at least as many of the SAME character. An unclosed fence runs to
// the end of the document, which is how markdown itself reads it.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/

function maskFences(source: string): string {
  const lines = source.split('\n')
  let openedWith: string | null = null
  const masked = lines.map((line) => {
    const fence = FENCE_LINE.exec(line)?.[1]
    if (openedWith === null) {
      if (fence === undefined) return line
      openedWith = fence
      return blank(line)
    }
    if (
      fence !== undefined &&
      fence[0] === openedWith[0] &&
      fence.length >= openedWith.length
    ) {
      openedWith = null
    }
    return blank(line)
  })
  return masked.join('\n')
}

function maskInlineCode(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    if (source[i] !== '`') {
      out += source[i]
      i += 1
      continue
    }
    const open = runLength(source, i)
    const closeAt = findClosingRun(source, i + open, open)
    if (closeAt === -1) {
      // No matching run: these backticks are literal text, not a delimiter.
      out += source.slice(i, i + open)
      i += open
      continue
    }
    const end = closeAt + open
    out += blank(source.slice(i, end))
    i = end
  }
  return out
}

/** Length of the backtick run starting at `from`. */
function runLength(source: string, from: number): number {
  let n = 0
  while (source[from + n] === '`') n += 1
  return n
}

/** Index of the next backtick run of EXACTLY `size`, at or after `from`; -1 when there is none. */
function findClosingRun(source: string, from: number, size: number): number {
  for (let i = from; i < source.length; i++) {
    if (source[i] !== '`') continue
    const run = runLength(source, i)
    if (run === size) return i
    i += run - 1
  }
  return -1
}

/** Same length, same line breaks, no content — offsets survive, matches cannot. */
function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ')
}
