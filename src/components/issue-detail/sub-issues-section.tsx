// ABOUTME: Linear-style sub-issues block for the issue detail body — a collapsible header with a
// ABOUTME: progress ring, indented child rows, and the inline composer that files a new child.

import { Link } from '@tanstack/react-router'
import { ChevronRight, Plus, SlidersHorizontal } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { EpicProgress } from '@/components/projects/epic-progress'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { BeadId, beadRefTitle, StatusIcon } from '@/lib/issue-meta'
import { cn } from '@/lib/utils'
import { AssigneeAvatar } from './assignee-avatar'
import { SectionHeading } from './detail-chrome'
import { SubIssueComposer, type SubIssueDraft } from './sub-issue-composer'
import {
  filterSubIssues,
  mergeSubIssues,
  orderSubIssues,
  type SubIssue,
  subIssueProgress,
} from './sub-issues-model'
import type { IssueEditDeps } from './use-issue-edits'
import { useSectionCollapse } from './use-section-collapse'

export interface SubIssuesSectionProps {
  /** The issue these children hang off — the parent every create is filed under. */
  parentId: string
  /** Children from the route loader. Locally created ones merge in on top. */
  childIssues: readonly SubIssue[]
  /** Search params carried onto row navigation (preserves `project`). */
  search: { project?: string }
  /** Injected create so this never imports server fns (keeps component tests server-fn free). */
  createSubIssue: IssueEditDeps['createSubIssue']
  /** Called after a successful create so the host can mark list routes stale. */
  onCreated?: () => void
}

/** One collapse preference for the whole app, remembered for the browser session. */
const COLLAPSE_KEY = 'sub-issues'

export function SubIssuesSection({
  parentId,
  childIssues,
  search,
  createSubIssue,
  onCreated,
}: SubIssuesSectionProps) {
  const listId = useId()
  const { expanded, toggle, expand } = useSectionCollapse(COLLAPSE_KEY)
  const [showCompleted, setShowCompleted] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Children created here render immediately, before the route loader catches up (KTD8).
  const [created, setCreated] = useState<SubIssue[]>([])

  // Navigating to a different issue reuses this component; drop the previous issue's local
  // creations rather than showing them under the new parent.
  const lastParentId = useRef(parentId)
  if (lastParentId.current !== parentId) {
    lastParentId.current = parentId
    setCreated([])
    setComposerOpen(false)
    setError(null)
  }

  const all = mergeSubIssues(childIssues, created)
  const progress = subIssueProgress(all)
  const rows = orderSubIssues(filterSubIssues(all, showCompleted))

  const openComposer = () => {
    setError(null)
    setComposerOpen(true)
    expand()
  }

  const create = async (draft: SubIssueDraft) => {
    setSaving(true)
    setError(null)
    try {
      const child = await createSubIssue({ ...draft, parentId })
      setCreated((prev) => [...prev, child])
      setComposerOpen(false)
      onCreated?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={expanded ? 'Collapse sub-issues' : 'Expand sub-issues'}
          onClick={toggle}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform',
              expanded && 'rotate-90',
            )}
            aria-hidden="true"
          />
        </button>
        <SectionHeading>Sub-issues</SectionHeading>
        {progress.total > 0 && (
          <EpicProgress closed={progress.closed} total={progress.total} />
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Sub-issue display options"
                className="text-muted-foreground hover:text-foreground"
              >
                <SlidersHorizontal />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-2 text-[13px]">
              <button
                type="button"
                aria-pressed={showCompleted}
                onClick={() => setShowCompleted(!showCompleted)}
                className={cn(
                  'flex w-full items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-accent',
                  showCompleted ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                Show completed
                <span
                  className={cn(
                    'size-2 rounded-full',
                    showCompleted ? 'bg-indigo-500' : 'bg-border',
                  )}
                  aria-hidden="true"
                />
              </button>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Add sub-issue"
            onClick={openComposer}
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus />
          </Button>
        </div>
      </div>

      {expanded && (
        <div
          id={listId}
          data-sub-issues-list
          className="flex flex-col gap-1 pl-6"
        >
          {rows.map((issue) => (
            <SubIssueRow
              key={issue.id}
              issue={issue}
              project={search.project}
            />
          ))}

          {composerOpen ? (
            <SubIssueComposer
              saving={saving}
              error={error}
              onCancel={() => setComposerOpen(false)}
              onCreate={create}
            />
          ) : (
            rows.length === 0 && (
              <button
                type="button"
                onClick={openComposer}
                className="self-start rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Add sub-issues
              </button>
            )
          )}

          {/* A create that failed with the composer closed still has to report itself. */}
          {!composerOpen && error && (
            <p role="alert" className="px-1 text-xs text-red-500">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

// A child row — navigates to the child's own detail, carrying the project so the loader targets
// the right beads dir (KTD13).
function SubIssueRow({
  issue,
  project,
}: {
  issue: SubIssue
  project?: string
}) {
  return (
    <Link
      to="/issues/$issueId"
      params={{ issueId: issue.id }}
      search={{ project }}
      title={beadRefTitle(issue.id, issue.title)}
      className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent/50"
    >
      <StatusIcon status={issue.status} />
      <span className="min-w-0 flex-1 truncate text-[13px]">{issue.title}</span>
      {/* The body has room for both, so the id stays visible here — muted, after the title. */}
      <BeadId id={issue.id} />
      <AssigneeAvatar assignee={issue.assignee} />
    </Link>
  )
}
