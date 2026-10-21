// ABOUTME: Editable properties rail for the issue detail view — inline status, priority, assignee,
// ABOUTME: label, and pull-request editors, plus grouped dependency rows that navigate to a linked
// ABOUTME: issue's detail.

import { Tag, UserRound, X } from 'lucide-react'
import { useState } from 'react'
import { useStatusPipeline } from '@/components/status-pipeline-context'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { prUrlOf } from '@/lib/beads/pr-link'
import type { PrStatus } from '@/lib/beads/pr-state'
import type { Issue, ShowIssue } from '@/lib/beads/types'
import { isKnownIssueType, knownIssueTypes } from '@/lib/beads/types'
import {
  labelColorClass,
  PriorityIcon,
  priorityLabel,
  StatusIcon,
  statusLabel,
  TypeIcon,
  typeLabel,
} from '@/lib/issue-meta'
import { DependencyEditor } from './dependency-editor'
import { SectionHeading } from './detail-chrome'
import { PullRequestRow } from './pull-request-row'
import type { useIssueEdits } from './use-issue-edits'

export interface PropertiesRailProps {
  issue: ShowIssue
  /** Inline-edit actions + saving state from the detail edit hook. */
  saving: boolean
  /** The single inline-edit error from the hook, surfaced once at the top of the rail so it's
   * never misattributed to a specific control (a status edit failing must not look like a
   * dependency error). Null when there's nothing to show. */
  error: string | null
  actions: ReturnType<typeof useIssueEdits>['actions']
  /** Candidate issues for the dependency picker. */
  listCandidates: () => Promise<Issue[]>
  /** Live PR state for the linked pr_url. Injected like the other reads so the rail never
   * imports server fns; fails soft to `unknown` rather than rejecting. */
  getPrState: (url: string) => Promise<PrStatus>
  /** Search params to carry onto dependency-row navigation (preserves `project`). */
  search: { project?: string }
  /** Hide the rail's "Sub-issues" group (the body's sub-issues section shows them instead). */
  hideSubIssueGroup?: boolean
}

export function PropertiesRail({
  issue,
  saving,
  error,
  actions,
  listCandidates,
  getPrState,
  search,
  hideSubIssueGroup,
}: PropertiesRailProps) {
  const { statuses } = useStatusPipeline()
  // A just-created status remains selectable while the project loader catches up.
  const statusOptions = statuses.includes(issue.status)
    ? statuses
    : [issue.status, ...statuses]
  // Same for type: a custom type stays selectable rather than vanishing from the list.
  const typeOptions = isKnownIssueType(issue.issue_type)
    ? [...knownIssueTypes]
    : [issue.issue_type, ...knownIssueTypes]

  return (
    <div className="flex flex-col gap-4 text-[13px] detail-compact:contents">
      {error && (
        <p
          role="alert"
          className="text-xs text-red-500 detail-compact:order-2 detail-compact:mx-6 detail-compact:mt-3"
        >
          {error}
        </p>
      )}
      <div
        data-property-group=""
        className="flex flex-col gap-4 detail-compact:order-2 detail-compact:mx-6 detail-compact:mt-4 detail-compact:flex-row detail-compact:flex-wrap detail-compact:items-center detail-compact:gap-2 detail-compact:border-y detail-compact:py-3"
      >
        <section className="flex flex-col gap-1.5 detail-compact:contents">
          <div className="detail-compact:hidden">
            <SectionHeading>Properties</SectionHeading>
          </div>
          <div className="flex flex-col items-start gap-1 detail-compact:contents">
            <Select
              value={issue.issue_type}
              onValueChange={(type) => actions.setType(type)}
              disabled={saving}
            >
              <SelectTrigger
                size="sm"
                aria-label="Type"
                className="h-7 justify-start gap-1.5 border-none px-2 shadow-none detail-compact:h-8 detail-compact:rounded-full detail-compact:border detail-compact:bg-background detail-compact:px-3 detail-compact:shadow-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    <TypeIcon type={t} />
                    {typeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={issue.status}
              onValueChange={(status) => actions.setStatus(status)}
              disabled={saving}
            >
              <SelectTrigger
                size="sm"
                aria-label="Status"
                className="h-7 justify-start gap-1.5 border-none px-2 shadow-none detail-compact:h-8 detail-compact:rounded-full detail-compact:border detail-compact:bg-background detail-compact:px-3 detail-compact:shadow-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    <StatusIcon status={s} />
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(issue.priority)}
              onValueChange={(v) => actions.setPriority(Number(v))}
              disabled={saving}
            >
              <SelectTrigger
                size="sm"
                aria-label="Priority"
                className="h-7 justify-start gap-1.5 border-none px-2 shadow-none detail-compact:h-8 detail-compact:rounded-full detail-compact:border detail-compact:bg-background detail-compact:px-3 detail-compact:shadow-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3, 4].map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    <PriorityIcon priority={p} />
                    {priorityLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AssigneeEditor
              key={`${issue.id}:${issue.assignee ?? ''}`}
              value={issue.assignee ?? ''}
              disabled={saving}
              onCommit={(assignee) => actions.setAssignee(assignee)}
            />
          </div>
        </section>

        <section className="flex flex-col gap-1.5 detail-compact:contents">
          <div className="detail-compact:hidden">
            <SectionHeading>Labels</SectionHeading>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {issue.labels?.map((label) => (
              <Badge
                key={label}
                variant="outline"
                className="gap-1.5 rounded-full border-border/70 text-xs font-normal text-muted-foreground"
              >
                <span
                  className={`size-2 rounded-full ${labelColorClass(label)}`}
                  aria-hidden="true"
                />
                {label}
                <button
                  type="button"
                  aria-label={`Remove label ${label}`}
                  disabled={saving}
                  onClick={() => actions.removeLabel(label)}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            <LabelAdder
              disabled={saving}
              onAdd={(label) => actions.addLabel(label)}
            />
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-4 detail-compact:order-4 detail-compact:mx-6 detail-compact:py-5">
        {/* The bead's latest PR (pr_url metadata). Its own full-width section rather than a
            narrow property row: the number, title, and state badge need the rail's full width,
            and it reads like the dependency groups below it — one more linked thing. */}
        <section data-pull-request="" className="flex flex-col gap-1.5">
          <SectionHeading>Pull request</SectionHeading>
          <PullRequestRow
            prUrl={prUrlOf(issue)}
            saving={saving}
            onLink={(ref) => actions.setPrUrl(ref)}
            onUnlink={() => actions.clearPrUrl()}
            getPrState={getPrState}
          />
        </section>

        <DependencyEditor
          issue={issue}
          saving={saving}
          actions={actions}
          listCandidates={listCandidates}
          search={search}
          hideSubIssueGroup={hideSubIssueGroup}
        />
      </div>
    </div>
  )
}

function AssigneeEditor({
  value,
  disabled,
  onCommit,
}: {
  value: string
  disabled: boolean
  onCommit: (assignee: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const commit = () => {
    const next = draft.trim()
    if (next !== value) onCommit(next)
  }
  return (
    <div className="flex h-7 items-center gap-1.5 px-2 text-muted-foreground detail-compact:h-8 detail-compact:rounded-full detail-compact:border detail-compact:bg-background detail-compact:px-3 detail-compact:shadow-xs">
      <UserRound className="size-4 shrink-0" aria-hidden="true" />
      <Input
        aria-label="Assignee"
        value={draft}
        disabled={disabled}
        placeholder="Assign"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        className="h-7 w-40 border-none bg-transparent px-0 text-sm text-foreground shadow-none focus-visible:ring-0 detail-compact:h-6 detail-compact:w-28 dark:bg-transparent"
      />
    </div>
  )
}

function LabelAdder({
  disabled,
  onAdd,
}: {
  disabled: boolean
  onAdd: (label: string) => void
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="flex h-7 items-center gap-1.5 px-2 text-muted-foreground detail-compact:h-8 detail-compact:rounded-full detail-compact:border detail-compact:bg-background detail-compact:px-3 detail-compact:shadow-xs">
      <Tag className="size-3.5 shrink-0" aria-hidden="true" />
      <Input
        aria-label="Add label"
        value={draft}
        disabled={disabled}
        placeholder="Add label"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && draft.trim()) {
            onAdd(draft.trim())
            setDraft('')
          }
        }}
        className="h-6 w-20 border-none bg-transparent px-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}
