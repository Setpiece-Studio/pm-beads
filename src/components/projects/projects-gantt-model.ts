// ABOUTME: Read-only Gantt layout in work units, sequenced within owner lanes.
// ABOUTME: Counts leaf descendants independently of filters and annotates real blocking edges.

import type { Issue } from '@/lib/beads/types'
import type { EpicBlockingEdges } from './projects-model'

export interface GanttBar {
  issue: Issue
  start: number
  end: number
  total: number
  closed: number
  cyclic: boolean
}

function rank(issue: Issue): number {
  const raw = issue.metadata?.gantt_order
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

export function buildGantt(
  projects: Issue[],
  allIssues: Issue[],
  edges: EpicBlockingEdges,
) {
  const children = new Map<string, Issue[]>()
  for (const issue of allIssues) {
    if (!issue.parent) continue
    const siblings = children.get(issue.parent) ?? []
    siblings.push(issue)
    children.set(issue.parent, siblings)
  }
  const owners = new Map<string, Issue[]>()
  for (const project of projects) {
    const owner = project.assignee?.trim() || ''
    const lane = owners.get(owner) ?? []
    lane.push(project)
    owners.set(owner, lane)
  }
  const lanes = [...owners.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([owner, projects]) => {
      let offset = 0
      const bars = [...projects]
        .sort(
          (a, b) =>
            rank(a) - rank(b) ||
            a.priority - b.priority ||
            a.title.localeCompare(b.title) ||
            a.id.localeCompare(b.id),
        )
        .map((issue): GanttBar => {
          let total = 0
          let closed = 0
          let cyclic = false
          const seen = new Set([issue.id])
          const pending = [...(children.get(issue.id) ?? [])]
          while (pending.length) {
            const child = pending.pop()
            if (!child) break
            if (seen.has(child.id)) {
              cyclic = true
              continue
            }
            seen.add(child.id)
            const descendants = children.get(child.id) ?? []
            if (descendants.length) pending.push(...descendants)
            else if (child.issue_type !== 'epic') {
              total++
              if (child.status === 'closed') closed++
            }
          }
          const start = offset
          offset += Math.max(1, total)
          return { issue, total, closed, cyclic, start, end: offset }
        })
      return { key: owner, owner: owner || 'Unassigned', bars }
    })
  const bars = new Map(
    lanes.flatMap((lane) =>
      lane.bars.map((bar) => [bar.issue.id, bar] as const),
    ),
  )
  const links: { from: string; to: string; conflict: boolean }[] = []
  let hiddenBlockers = 0
  for (const bar of bars.values()) {
    for (const id of new Set(edges[bar.issue.id] ?? [])) {
      const blocker = bars.get(id)
      if (!blocker) {
        hiddenBlockers++
        continue
      }
      links.push({
        from: id,
        to: bar.issue.id,
        conflict: blocker.end > bar.start,
      })
    }
  }
  return { lanes, links, hiddenBlockers }
}

export type GanttModel = ReturnType<typeof buildGantt>
