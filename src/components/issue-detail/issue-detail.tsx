// ABOUTME: Presentational issue detail shell with a scrolling body and responsive properties.
// ABOUTME: The desktop rail reflows beneath the title at the 750px narrow breakpoint.

import { type UIEvent, useCallback, useEffect, useRef, useState } from 'react'
import { EpicProgress } from '@/components/projects/epic-progress'
import { parseAsks } from '@/lib/beads/asks'
import type { Issue, ShowIssue } from '@/lib/beads/types'
import { ActivitySection } from './activity-section'
import { AddSectionMenu } from './add-section-menu'
import { SectionHeading } from './detail-chrome'
import { EditableTitle } from './editable-title'
import { type LongTextField, LongTextSection } from './long-text-section'
import { MilestonesSection } from './milestones-section'
import { PropertiesRail } from './properties-rail'
import { SubIssuesSection } from './sub-issues-section'
import {
  type IssueEditDeps,
  type TextSaveOutcome,
  useIssueEdits,
} from './use-issue-edits'

/** The bd long-text fields that only appear once they have content, or once the reader opens one
 * from the add menu. `description` is not among them — it is the body and always has a place. */
const OPTIONAL_LONG_TEXT = ['design', 'acceptance_criteria', 'notes'] as const

/** Epic completion counts (KTD9): both come from the recursive bd path so they reconcile. */
export interface EpicProgressData {
  closed: number
  total: number
}

export interface IssueDetailProps {
  /** Loader-provided issue; seeds the edit hook's local state (KTD8 — loader owns the read). */
  issue: ShowIssue
  /** Injected write deps so inline edits never import server fns into component tests. */
  deps: IssueEditDeps
  /** Called after a successful inline edit so the route can router.invalidate() the list. */
  onMutated?: () => void
  /** Completed loader revision; applies fresh same-ID reads without discarding drafts. */
  revision?: unknown
  /** Search params carried onto in-detail navigation (preserves `project`). */
  search: { project?: string }
  /** Epic-only: closed/total child completion. Renders the progress display when provided. */
  progress?: EpicProgressData
  /** Child issues (bd list --parent). Renders the sub-issues section when provided; absent means
   * the host route didn't load children and the section stays out of the body entirely. */
  childIssues?: Issue[]
  /** Comment id from a `#comment-<id>` deep link, passed on to the activity stream so the row
   * it names is scrolled to and highlighted. */
  commentAnchor?: string
  /** Called once the reader scrolls the issue body to its bottom. */
  onReachBottom?: () => void
  /** Keep properties above the body when hosted in the inbox's split pane. */
  compactProperties?: boolean
}

export function IssueDetail({
  issue: initialIssue,
  deps,
  onMutated,
  revision,
  search,
  progress,
  childIssues,
  commentAnchor,
  onReachBottom,
  compactProperties = false,
}: IssueDetailProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const reachedBottom = useRef(false)
  const { issue, saving, error, actions, listCandidates, getPrState } =
    useIssueEdits(initialIssue, deps, onMutated, revision)
  const parsedAsks = parseAsks(issue.metadata)

  // Sections the reader asked for that bd has nothing in yet. Local, because an empty section is
  // an intention rather than a fact about the issue — nothing is written until they type.
  const [opened, setOpened] = useState<LongTextField[]>([])
  const openSection = useCallback(
    (field: LongTextField) =>
      setOpened((fields) =>
        fields.includes(field) ? fields : [...fields, field],
      ),
    [],
  )
  const closeSection = useCallback(
    (field: LongTextField) =>
      setOpened((fields) => fields.filter((f) => f !== field)),
    [],
  )
  const longTextActions: Record<
    (typeof OPTIONAL_LONG_TEXT)[number],
    (value: string, baseline: string) => Promise<TextSaveOutcome>
  > = {
    design: actions.setDesign,
    acceptance_criteria: actions.setAcceptanceCriteria,
    notes: actions.setNotes,
  }

  // Move focus to the title on mount so keyboard/screen-reader users land on the
  // primary heading, not the top of the page.
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const node = event.currentTarget
    if (
      !reachedBottom.current &&
      node.scrollHeight - node.scrollTop - node.clientHeight <= 8
    ) {
      reachedBottom.current = true
      onReachBottom?.()
    }
  }

  return (
    <div
      className="@container h-full min-h-0"
      data-compact-properties={compactProperties || undefined}
    >
      <div
        data-testid="issue-scroll"
        className="flex h-full min-h-0 detail-compact:flex-col detail-compact:overflow-y-auto"
        onScroll={handleScroll}
      >
        <div
          className="min-w-0 flex-1 overflow-y-auto detail-compact:contents"
          onScroll={handleScroll}
        >
          <header className="order-1 px-6 pt-5">
            <div className="mx-auto min-w-0 max-w-3xl">
              <EditableTitle
                key={issue.id}
                title={issue.title}
                saving={saving}
                onSave={actions.setTitle}
                headingRef={titleRef}
              />

              {(parsedAsks.asks.length > 0 ||
                parsedAsks.invalidKeys.length > 0) && (
                <div className="mt-5">
                  <MilestonesSection
                    key={issue.id}
                    asks={parsedAsks.asks}
                    invalidKeys={parsedAsks.invalidKeys}
                    saving={saving}
                    onAnswer={actions.answerAsk}
                  />
                </div>
              )}
            </div>
          </header>

          <main data-issue-body="" className="order-3 min-w-0 px-6 pt-5 pb-5">
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {progress && (
                <section className="flex items-center gap-2">
                  <SectionHeading>Progress</SectionHeading>
                  <EpicProgress
                    closed={progress.closed}
                    total={progress.total}
                  />
                </section>
              )}

              {/* Keyed on the issue so navigating away drops any half-typed draft. */}
              <LongTextSection
                key={issue.id}
                field="description"
                value={issue.description}
                saving={saving}
                onSave={actions.setDescription}
              />

              {childIssues && (
                <SubIssuesSection
                  parentId={issue.id}
                  childIssues={childIssues}
                  search={search}
                  createSubIssue={deps.createSubIssue}
                  onCreated={onMutated}
                />
              )}

              {OPTIONAL_LONG_TEXT.map((field) =>
                issue[field]?.trim() || opened.includes(field) ? (
                  <LongTextSection
                    key={`${issue.id}:${field}`}
                    field={field}
                    value={issue[field]}
                    saving={saving}
                    onSave={longTextActions[field]}
                    autoEdit={opened.includes(field)}
                    onAbandon={() => closeSection(field)}
                  />
                ) : null,
              )}

              <AddSectionMenu
                available={OPTIONAL_LONG_TEXT.filter(
                  (field) => !issue[field]?.trim() && !opened.includes(field),
                )}
                onAdd={openSection}
              />

              {/* Comments render inside the activity stream, interleaved with history events. */}
              <ActivitySection
                issue={issue}
                deps={deps}
                onCommented={onMutated}
                commentAnchor={commentAnchor}
              />
            </div>
          </main>
        </div>

        {/* 24rem rather than 18rem: the rail's dependency rows are titles now, and at 18rem a
            title truncated to two words said less than the id it replaced. The body keeps its
            max-w-3xl measure and simply gets the remaining width. */}
        <aside
          aria-label="Properties"
          className="sticky top-0 h-full w-96 shrink-0 overflow-y-auto border-l bg-muted/20 px-4 py-5 detail-compact:contents"
        >
          <PropertiesRail
            issue={issue}
            saving={saving}
            error={error}
            actions={actions}
            listCandidates={listCandidates}
            getPrState={getPrState}
            search={search}
            // Children render in the dedicated body section; suppress the rail's duplicate
            // "Sub-issues" group when that section is present. The "Parent" group (the other
            // direction of the same edge type) stays — nothing else surfaces it.
            hideSubIssueGroup={childIssues !== undefined}
          />
        </aside>
      </div>
    </div>
  )
}
