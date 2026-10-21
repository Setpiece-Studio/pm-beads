// ABOUTME: React context that tells markdown bead chips which beads exist — the project's id
// ABOUTME: prefix, each bead's status/title/type, the ?project= to carry, and how to open one.

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { beadIdPrefix } from './beads/pr-backfill'

/** The bead fields a chip needs. A structural subset of `Issue`, so routes pass what they hold
 * without this module importing bd's schemas. */
export interface BeadLookupIssue {
  id: string
  title: string
  status: string
  issue_type: string
}

/** What a chip reads. Absent (no provider) means no prefix and no statuses: bare ids and
 * `[[id]]` stay plain text, and only a pm-beads url — which names its bead outright — still
 * renders a chip, without a status glyph. */
export interface BeadLookup {
  /** The project's bead-id prefix (`pm-beads-`), read from the loaded ids. Null when the set
   * is empty or disagrees, in which case bare ids are unresolvable. */
  prefix: string | null
  /** The bead's status, or undefined when it is not in the loaded set. */
  statusOf: (id: string) => string | undefined
  /** The bead's title, or undefined when it is not in the loaded set. Chips use it as the
   * link's `title` attribute. */
  titleOf: (id: string) => string | undefined
  /** Whether the bead is an epic — an epic's canonical home is /projects/$id, not /issues/$id
   * (KTD12), so the chip has to link straight there. */
  isEpic: (id: string) => boolean
  /** Carried onto every chip's link so the target loads from the same beads dir (KTD13). */
  project?: string
  /** When provided, a plain click calls this instead of navigating — the inbox opens its
   * related-bead drawer rather than leaving the conversation. Chips still render an href, so
   * middle-click and "open in new tab" keep working. */
  onOpenBead?: (id: string) => void
}

const BeadLookupContext = createContext<BeadLookup | null>(null)

/** The bead lookup in scope, or null where no route provided one. */
export function useBeadLookup(): BeadLookup | null {
  return useContext(BeadLookupContext)
}

export interface BeadLookupProviderProps {
  /** Every bead the route loaded — `listIssuesFn({ all: true })`, which reads through the bd
   * cache. Statuses and titles come from here, and so does the id prefix. */
  issues: readonly BeadLookupIssue[]
  /** The `?project=` in the URL, carried onto chip links. */
  project?: string
  /** Optional click interception; see `BeadLookup.onOpenBead`. Memoize it at the call site —
   * a new function identity on every render re-renders every chip below. */
  onOpenBead?: (id: string) => void
  children: ReactNode
}

export function BeadLookupProvider({
  issues,
  project,
  onOpenBead,
  children,
}: BeadLookupProviderProps) {
  const value = useMemo<BeadLookup>(() => {
    const byId = new Map(
      issues.map((issue) => [issue.id.toLowerCase(), issue] as const),
    )
    return {
      prefix: beadIdPrefix(issues.map((issue) => issue.id)),
      statusOf: (id) => byId.get(id.toLowerCase())?.status,
      titleOf: (id) => byId.get(id.toLowerCase())?.title,
      isEpic: (id) => byId.get(id.toLowerCase())?.issue_type === 'epic',
      project,
      onOpenBead,
    }
  }, [issues, project, onOpenBead])

  return (
    <BeadLookupContext.Provider value={value}>
      {children}
    </BeadLookupContext.Provider>
  )
}

/** The four fields a lookup needs, off a fuller issue list. Routes call this in the loader so
 * the SSR payload carries one small row per bead rather than every bd field. */
export function beadLookupIssues(
  issues: readonly BeadLookupIssue[],
): BeadLookupIssue[] {
  return issues.map(({ id, title, status, issue_type }) => ({
    id,
    title,
    status,
    issue_type,
  }))
}
