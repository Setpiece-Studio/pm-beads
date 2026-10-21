// ABOUTME: Single source of truth keyed on (dependency_type, direction): group labels, the bd
// ABOUTME: mutation verb + argument order, and grouping of bd show's linked issues for display.

import type { LinkedIssue, ShowIssue } from './types'

// 'down' = the edge came from bd show's dependencies[] — THIS issue depends on the neighbor.
// 'up'   = the edge came from bd show's dependents[]   — the neighbor depends on THIS issue.
export type DependencyDirection = 'down' | 'up'

// --- Group labels ---------------------------------------------------------

// Directional wording per (type, direction). relates-to reads "Related" in both directions
// because the edge is symmetric.
const GROUP_LABELS: Record<string, { down: string; up: string }> = {
  blocks: { down: 'Blocked by', up: 'Blocking' },
  'parent-child': { down: 'Parent', up: 'Sub-issues' },
  'relates-to': { down: 'Related', up: 'Related' },
  'discovered-from': { down: 'Discovered from', up: 'Discovered here' },
  supersedes: { down: 'Supersedes', up: 'Superseded by' },
}

// "discovered-from" → "Discovered from"; "caused-by" → "Caused by".
function humanize(type: string): string {
  const words = type.split(/[-_\s]+/).filter(Boolean)
  if (words.length === 0) return type
  return words
    .map((word, i) =>
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(' ')
}

/**
 * Human-readable group label for a relationship of `type` seen in `direction`. Falls back to a
 * humanized label for unrecognized types (e.g. "caused-by" → "Caused by") in BOTH directions so an
 * unmapped bd type renders something legible instead of blank or a crash. The fallback is direction
 * -agnostic — adding a directional suffix risks nonsense like "Caused by by"; a rare future type
 * gets a plain label until it earns an explicit GROUP_LABELS entry.
 */
export function dependencyGroupLabel(
  type: string,
  direction: DependencyDirection,
): string {
  const known = GROUP_LABELS[type]
  if (known) return known[direction]
  return humanize(type)
}

// --- Mutation mapping -----------------------------------------------------

// The verb family the editor must call. 'relate' → relateIssues/unrelateIssues (symmetric,
// order-insensitive); 'dep' → addDependency/removeDependency (directed, order encodes
// direction and remove must mirror add's order). Internal to this module's DependencyMutation.
type DependencyVerb = 'dep' | 'relate'

export interface DependencyMutation {
  verb: DependencyVerb
  type: string
  /** Arg pair for add/remove. For 'dep', addDependency(issueId, dependsOnId, type) and
   * removeDependency(issueId, dependsOnId) reuse this exact order. For 'relate', the pair is
   * passed to relateIssues/unrelateIssues, which ignore order. */
  issueId: string
  dependsOnId: string
}

/**
 * Resolve the bd mutation an editor must perform for a relationship of `(type, direction)` between
 * the current issue (`thisId`) and the neighbor (`otherId`). Owns argument order so remove mirrors
 * add: 'down' means thisId depends on otherId → addDependency(thisId, otherId); 'up' means otherId
 * depends on thisId → addDependency(otherId, thisId). relates-to maps to the symmetric relate verb.
 */
export function dependencyMutation(
  type: string,
  direction: DependencyDirection,
  thisId: string,
  otherId: string,
): DependencyMutation {
  if (type === 'relates-to') {
    return { verb: 'relate', type, issueId: thisId, dependsOnId: otherId }
  }
  // 'down': this depends on other → (this, other). 'up': other depends on this → (other, this).
  const [issueId, dependsOnId] =
    direction === 'down' ? [thisId, otherId] : [otherId, thisId]
  return { verb: 'dep', type, issueId, dependsOnId }
}

// --- Grouping for display -------------------------------------------------

interface DependencyMember {
  issue: LinkedIssue
  direction: DependencyDirection
}

export interface DependencyGroup {
  /** Stable key combining type and direction, e.g. "blocks:down". */
  key: string
  type: string
  direction: DependencyDirection
  label: string
  members: DependencyMember[]
}

// Display order for groups: the common, action-relevant relationships first, then the rest
// alphabetically by label. Anything not listed (humanized fallback types) sorts after these.
export const GROUP_ORDER: ReadonlyArray<[string, DependencyDirection]> = [
  ['blocks', 'down'], // Blocked by
  ['blocks', 'up'], // Blocking
  ['parent-child', 'down'], // Parent
  ['parent-child', 'up'], // Sub-issues
  ['relates-to', 'down'], // Related
  ['discovered-from', 'down'], // Discovered from
  ['discovered-from', 'up'], // Discovered here
  ['supersedes', 'down'], // Supersedes
  ['supersedes', 'up'], // Superseded by
]

function groupOrderIndex(type: string, direction: DependencyDirection): number {
  const i = GROUP_ORDER.findIndex(([t, d]) => t === type && d === direction)
  return i === -1 ? GROUP_ORDER.length : i
}

function groupKey(type: string, direction: DependencyDirection): string {
  return `${type}:${direction}`
}

/**
 * Group an issue's linked issues into ordered, labeled display groups. Accepts either a full
 * ShowIssue or its dependencies/dependents arrays directly. relates-to neighbors are DEDUPED by
 * linked-issue id across both arrays (a symmetric edge appears in both) and collapse into a single
 * Related group. Only non-empty groups are returned, in the defined display order.
 */
export function groupDependencies(
  source:
    | ShowIssue
    | {
        dependencies?: LinkedIssue[] | null
        dependents?: LinkedIssue[] | null
      },
): DependencyGroup[] {
  const dependencies = source.dependencies ?? []
  const dependents = source.dependents ?? []

  const groups = new Map<string, DependencyGroup>()
  const seenRelatedIds = new Set<string>()

  const add = (issue: LinkedIssue, direction: DependencyDirection) => {
    const type = issue.dependency_type
    // relates-to is symmetric: the same neighbor appears in both arrays. Collapse to one entry
    // (deduped by linked-issue id), always grouped under the canonical 'down' Related group.
    if (type === 'relates-to') {
      if (seenRelatedIds.has(issue.id)) return
      seenRelatedIds.add(issue.id)
      direction = 'down'
    }
    const key = groupKey(type, direction)
    const existing = groups.get(key)
    if (existing) {
      existing.members.push({ issue, direction })
      return
    }
    groups.set(key, {
      key,
      type,
      direction,
      label: dependencyGroupLabel(type, direction),
      members: [{ issue, direction }],
    })
  }

  for (const issue of dependencies) add(issue, 'down')
  for (const issue of dependents) add(issue, 'up')

  return [...groups.values()].sort((a, b) => {
    const ai = groupOrderIndex(a.type, a.direction)
    const bi = groupOrderIndex(b.type, b.direction)
    if (ai !== bi) return ai - bi
    return a.label.localeCompare(b.label)
  })
}
