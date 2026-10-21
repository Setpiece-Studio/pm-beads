// ABOUTME: Editable dependency groups for the rail — navigable member rows titled by the linked
// ABOUTME: bead (id on hover), a remove control, and one "+ Add relationship" picker; add/remove
// ABOUTME: route through dependency-meta.

import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import {
  type DependencyDirection,
  dependencyMutation,
  groupDependencies,
} from '@/lib/beads/dependency-meta'
import type { Issue, ShowIssue } from '@/lib/beads/types'
import { beadRefTitle, StatusIcon } from '@/lib/issue-meta'
import { DependencyPicker, type RelationshipChoice } from './dependency-picker'
import { SectionHeading } from './detail-chrome'
import type { useIssueEdits } from './use-issue-edits'

export interface DependencyEditorProps {
  issue: ShowIssue
  /** Disable controls while a mutation is in flight. */
  saving: boolean
  /** Dependency mutation actions from the edit hook. Picked from useIssueEdits' actions so the
   * four signatures can't drift from the hook that produces them. */
  actions: Pick<
    ReturnType<typeof useIssueEdits>['actions'],
    'addDependency' | 'removeDependency' | 'relate' | 'unrelate'
  >
  /** Candidate issues for the picker. */
  listCandidates: () => Promise<Issue[]>
  /** Search params carried onto member-row navigation (preserves `project`). */
  search: { project?: string }
  /** Hide the "Sub-issues" group: the detail body renders children in its own section, so the
   * rail would otherwise list them twice. Only the child-facing ("up") direction is hidden — the
   * "Parent" group is the same edge type seen the other way and has no other home. */
  hideSubIssueGroup?: boolean
}

export function DependencyEditor({
  issue,
  saving,
  actions,
  listCandidates,
  search,
  hideSubIssueGroup,
}: DependencyEditorProps) {
  const thisId = issue.id
  const groups = groupDependencies(issue).filter(
    (g) =>
      !(hideSubIssueGroup && g.type === 'parent-child' && g.direction === 'up'),
  )

  // Remove dispatches through dependency-meta so the bd verb + argument order can't drift from
  // the rendered group: 'relate' rows unrelate (symmetric), everything else removes the directed
  // edge in the SAME order add produced it.
  const remove = (
    type: string,
    direction: DependencyDirection,
    otherId: string,
  ) => {
    const m = dependencyMutation(type, direction, thisId, otherId)
    if (m.verb === 'relate') actions.unrelate(m.issueId, m.dependsOnId)
    else actions.removeDependency(m.issueId, m.dependsOnId)
  }

  // Add dispatches through dependency-meta too: 'relate' adds a symmetric link, everything else
  // adds a directed edge whose argument order encodes the chosen direction.
  const add = (choice: RelationshipChoice, targetId: string) => {
    const m = dependencyMutation(
      choice.type,
      choice.direction,
      thisId,
      targetId,
    )
    if (m.verb === 'relate') actions.relate(m.issueId, m.dependsOnId)
    else actions.addDependency(m.issueId, m.dependsOnId, m.type)
  }

  // Exclude the current issue and issues already linked in the chosen relationship's group so the
  // picker can't offer a self-dependency or a duplicate. relates-to collapses to its canonical
  // 'down' group, matching groupDependencies' dedup. The lookup uses the FULL grouping (every
  // type/direction), not the display-filtered `groups`: on epic pages parent-child is hidden from
  // display, but its children are still linked and must be excluded so the picker never offers a
  // child bd would reject as a duplicate.
  const allGroups = groupDependencies(issue)
  const excludedIds = (choice: RelationshipChoice): Set<string> => {
    const excluded = new Set<string>([thisId])
    const direction = choice.type === 'relates-to' ? 'down' : choice.direction
    const key = `${choice.type}:${direction}`
    const group = allGroups.find((g) => g.key === key)
    for (const member of group?.members ?? []) excluded.add(member.issue.id)
    return excluded
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-1.5">
          <SectionHeading>{group.label}</SectionHeading>
          {group.members.map((member) => (
            <div
              key={`${group.key}:${member.issue.id}`}
              className="group flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 hover:bg-accent/50"
            >
              <Link
                to="/issues/$issueId"
                params={{ issueId: member.issue.id }}
                search={{ project: search.project }}
                // The rail is narrow even at 24rem: the title is the row, the id is the hover.
                title={beadRefTitle(member.issue.id, member.issue.title)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <StatusIcon status={member.issue.status} />
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {member.issue.title}
                </span>
              </Link>
              <button
                type="button"
                aria-label={`Remove ${group.label} ${member.issue.id}`}
                disabled={saving}
                onClick={() =>
                  remove(group.type, group.direction, member.issue.id)
                }
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </section>
      ))}

      <DependencyPicker
        listCandidates={listCandidates}
        excludedIds={excludedIds}
        disabled={saving}
        onConfirm={add}
      />
    </div>
  )
}
