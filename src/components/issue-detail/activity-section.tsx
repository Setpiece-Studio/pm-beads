// ABOUTME: The issue detail's Activity block — a vertical timeline interleaving bd history
// ABOUTME: events with comments and related messages, plus the comment composer at its foot.

import { useCallback, useEffect, useState } from 'react'
import { mergeActivity } from '@/lib/beads/activity'
import type { IssueActivity } from '@/lib/beads/queries'
import type { ShowIssue } from '@/lib/beads/types'
import { commentAnchorId } from '@/lib/comment-refs'
import { cn } from '@/lib/utils'
import {
  CommentCard,
  EventGlyph,
  EventRow,
  MessageCard,
} from './activity-items'
import { CommentComposer } from './comment-composer'
import { SectionHeading } from './detail-chrome'
import type { IssueEditDeps } from './use-issue-edits'

export interface ActivitySectionProps {
  /** The detail's live issue. Its comments seed the stream so it renders before the activity
   * read lands, and its updated_at re-reads activity after any inline edit. */
  issue: ShowIssue
  /** Injected reads/writes — the section never imports server fns (see server-deps.ts). */
  deps: Pick<IssueEditDeps, 'getActivity' | 'addComment'>
  /** Called after a comment posts so the host can invalidate the issue lists. */
  onCommented?: () => void
  /** The comment a `#comment-<id>` deep link asked for. Its row is scrolled into view and
   * highlighted once the stream holds it, so a quote in the inbox lands on the comment it
   * quoted rather than the top of the bead. */
  commentAnchor?: string
}

export function ActivitySection(props: ActivitySectionProps) {
  return <LazyActivitySection key={props.issue.id} {...props} />
}

function LazyActivitySection(props: ActivitySectionProps) {
  const [opened, setOpened] = useState(false)
  // Following a comment permalink is itself an explicit request to read comments.
  if (opened || props.commentAnchor !== undefined) {
    return <LoadedActivitySection {...props} />
  }
  return (
    <button
      type="button"
      className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
      onClick={() => setOpened(true)}
    >
      Load comments
    </button>
  )
}

function LoadedActivitySection({
  issue,
  deps,
  onCommented,
  commentAnchor,
}: ActivitySectionProps) {
  const issueId = issue.id
  const updatedAt = issue.updated_at
  // Seed from the loader's comments so the stream is never empty on first paint; the effect
  // replaces it with the full feed (events included) once bd answers.
  const [activity, setActivity] = useState<IssueActivity>(() => ({
    events: [],
    comments: issue.comments ?? [],
    messages: [],
    historyUnavailable: false,
  }))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  const { getActivity } = deps
  // Re-read on a new issue AND on a new updated_at: every inline edit in the rail bumps
  // updated_at, and the edit it just made is a history event this stream should show.
  // biome-ignore lint/correctness/useExhaustiveDependencies: updatedAt is the refetch trigger, not read here.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    getActivity(issueId)
      .then((fresh) => {
        if (!cancelled) {
          setActivity(fresh)
          setLoadError(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [getActivity, issueId, updatedAt, attempt])

  const postComment = useCallback(
    async (text: string) => {
      setActivity(await deps.addComment(issueId, text))
      setLoadError(null)
      onCommented?.()
    },
    [deps, issueId, onCommented],
  )

  const items = mergeActivity(
    activity.events,
    activity.comments,
    activity.messages,
  )

  // Runs on the anchored comment's arrival, not just on mount: the stream is seeded from the
  // loader's comments and replaced when the full feed lands, and a second deep link into a
  // bead already open changes the anchor without remounting anything.
  // biome-ignore lint/correctness/useExhaustiveDependencies: items.length is the arrival signal.
  useEffect(() => {
    if (commentAnchor === undefined) return
    const row = document.getElementById(commentAnchorId(commentAnchor))
    // jsdom has no scrollIntoView, and neither does a row that has not rendered yet.
    row?.scrollIntoView?.({ block: 'center' })
  }, [commentAnchor, items.length])

  return (
    <section className="flex flex-col gap-3">
      <SectionHeading>Activity</SectionHeading>
      {loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading comments…
        </p>
      )}

      {items.length > 0 && (
        <ol className="flex flex-col">
          {items.map((item, index) => {
            const next = items[index + 1]
            // The rail is connective tissue BETWEEN events, so it joins a pair of consecutive
            // event rows and nothing else: a comment or a message is a block that leaves the
            // timeline, not another beat on it.
            const railToNext = item.kind === 'event' && next?.kind === 'event'
            return (
              <li
                key={item.id}
                // Comment rows carry the anchor a `#comment-<id>` deep link lands on; history
                // events have no id anyone can link to.
                id={
                  item.kind === 'comment'
                    ? commentAnchorId(item.comment.id)
                    : undefined
                }
                className={cn(
                  'relative flex scroll-mt-4',
                  // Events run tight against each other and cards get real air, so the feed
                  // reads as quiet connective tissue punctuated by blocks.
                  next !== undefined && (railToNext ? 'pb-2' : 'pb-5'),
                  item.kind === 'comment' &&
                    item.comment.id === commentAnchor &&
                    'rounded-md ring-2 ring-sky-500/40',
                )}
              >
                {railToNext && (
                  <span
                    aria-hidden="true"
                    data-timeline-rail
                    className="absolute bottom-0 left-[9.5px] top-5 w-px bg-border"
                  />
                )}
                {item.kind === 'event' ? (
                  <>
                    <EventGlyph
                      event={item.event}
                      className="relative z-10 mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1 pl-3">
                      <EventRow event={item.event} />
                    </div>
                  </>
                ) : (
                  // Cards run the full width of the feed and carry their author inside their
                  // own header, so the timeline column belongs to the events alone.
                  <div className="min-w-0 flex-1">
                    {item.kind === 'comment' ? (
                      <CommentCard comment={item.comment} />
                    ) : (
                      <MessageCard message={item.message} />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}

      {activity.historyUnavailable && (
        <p className="text-xs text-muted-foreground">
          History unavailable for this issue — showing comments and related
          messages only.
        </p>
      )}
      {loadError && (
        <p role="alert" className="text-xs text-red-500">
          Couldn’t load activity: {loadError}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}

      {/* Flush with the comment cards above it — the card edge and the composer edge are the
          same column, so the feed reads as one. */}
      <CommentComposer onSubmit={postComment} />
    </section>
  )
}
