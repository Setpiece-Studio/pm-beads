// ABOUTME: Write-only mutation hook for the issue detail rail (KTD8) — the loader owns the read,
// ABOUTME: this owns inline edits, applying each mutation's returned fresh ShowIssue to local state.

import { useCallback, useRef, useState } from 'react'
import type {
  CreateSubIssueInput,
  GuardedTextField,
  TextFieldSaveResult,
  UpdateIssueFields,
} from '@/lib/beads/mutations'
import type { PrStatus } from '@/lib/beads/pr-state'
import type { IssueActivity } from '@/lib/beads/queries'
import type { Issue, ShowIssue } from '@/lib/beads/types'

// Injected write deps so the rail never imports server fns directly (keeps tests free of
// @tanstack/react-start). Every write returns the fresh ShowIssue from a server-side read, so
// the rail applies it directly and never issues a second serialized bd read. getIssue remains
// available as a fallback re-read of the rail issue (the directed dependency writes return the
// edge OWNER, which for an "up"/Blocking edge is the neighbor, not the rail). listCandidates
// supplies the dependency picker's target issues.
export interface IssueEditDeps {
  getIssue: (id: string) => Promise<ShowIssue>
  answerAsk: (
    id: string,
    key: string,
    answer: string | null,
  ) => Promise<ShowIssue>
  updateIssue: (id: string, fields: UpdateIssueFields) => Promise<ShowIssue>
  /** Write one whole-field text edit, but only while the stored text is still `baseline` — the
   * value the editor opened with. Resolves to a conflict instead of overwriting a rewrite the
   * editor never saw. */
  saveTextField: (
    id: string,
    field: GuardedTextField,
    value: string,
    baseline: string,
  ) => Promise<TextFieldSaveResult>
  closeIssue: (id: string, reason?: string) => Promise<ShowIssue>
  addLabel: (id: string, label: string) => Promise<ShowIssue>
  removeLabel: (id: string, label: string) => Promise<ShowIssue>
  addDependency: (
    issueId: string,
    dependsOnId: string,
    type: string,
  ) => Promise<ShowIssue>
  removeDependency: (issueId: string, dependsOnId: string) => Promise<ShowIssue>
  relate: (a: string, b: string) => Promise<ShowIssue>
  unrelate: (a: string, b: string) => Promise<ShowIssue>
  listCandidates: () => Promise<Issue[]>
  /** Activity stream read: history-derived events plus comments. Degrades to comments-only
   * rather than throwing when bd history is unavailable for the issue. */
  getActivity: (id: string) => Promise<IssueActivity>
  /** Posts a comment and returns the issue's fresh activity, so the stream renders it without
   * a second round trip. */
  addComment: (id: string, text: string) => Promise<IssueActivity>
  /** Create a child issue under this one (flat create + re-parent). Returns the fresh child so
   * the sub-issues section can render its row without waiting on a loader round-trip. */
  createSubIssue: (input: CreateSubIssueInput) => Promise<ShowIssue>
  /** Link a pull request by writing pr_url. `ref` is the raw input — a url, "#N", or "N";
   * a bare number is resolved server-side against the project's origin remote. */
  setPrUrl: (id: string, ref: string) => Promise<ShowIssue>
  /** Unlink the pull request (drops the pr_url key). */
  clearPrUrl: (id: string) => Promise<ShowIssue>
  /** Live PR state for a linked url. Fails soft to `unknown` rather than rejecting. */
  getPrState: (url: string) => Promise<PrStatus>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * What one guarded text save did, from its editor's point of view. A conflict is a refusal that
 * can say what the field holds now, so the editor shows the incoming text beside the draft it
 * kept instead of leaving the reader at a dead end. `storedText` is absent for every other kind
 * of refusal (a blank title, a bd failure) — those report on the rail's error line.
 */
export type TextSaveOutcome =
  | { saved: true }
  | { saved: false; storedText?: string }

/**
 * Inline-edit feedback for the detail rail. Seeds local ShowIssue state from the loader-provided
 * `initial` and re-syncs on a different issue ID or a completed loader revision.
 * Each mutation returns a fresh ShowIssue (read server-side after the write) which the rail applies
 * directly for instant feedback (KTD8) — no separate client re-read. The directed dependency writes
 * return the edge OWNER, which for a Blocking ("up") edge is the neighbor, not the rail; in that
 * one case the rail re-reads its own issue so its groups still refresh. After any success it calls
 * onMutated so the host can mark the issues/projects LIST stale for when the user navigates back.
 */
export function useIssueEdits(
  initial: ShowIssue,
  deps: IssueEditDeps,
  onMutated?: () => void,
  revision?: unknown,
) {
  const issueId = initial.id
  const [issue, setIssue] = useState<ShowIssue>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ordinary parent renders preserve local edits; completed loader revisions explicitly
  // refresh the same issue. Adjust during render so consumers never see a mismatched ID.
  // Ticket of the most recently STARTED mutation, and how many are still running. `saving`
  // disables controls a render too late to stop a second trigger (assignee onBlur plus a label
  // Enter, or a slow description save), so overlapping mutations are a fact to handle rather
  // than a state to prevent — see pm-beads-n88.
  const latestTicket = useRef(0)
  const inFlight = useRef(0)

  const lastIssueId = useRef(issueId)
  const lastRevision = useRef(revision)
  const refreshed = lastRevision.current !== revision
  lastRevision.current = revision
  if (lastIssueId.current !== issueId) {
    lastIssueId.current = issueId
    // Anything still in flight belongs to the issue we just left; retire its ticket so its
    // read can't land on the new one.
    latestTicket.current += 1
    setIssue(initial)
    setError(null)
  } else if (refreshed && inFlight.current === 0) {
    // A completed route read is authoritative; a mere parent render is not.
    // Keep editors mounted so their unsaved drafts and conflict baselines survive.
    setIssue(initial)
  }

  // Apply a mutation's returned ShowIssue to the rail. A directed dependency write returns the
  // edge owner, which for a Blocking ("up") edge is the neighbor — apply only the rail's own
  // issue; otherwise re-read the rail so its groups still refresh. Resolves to whether the write
  // landed, so a prose editor can keep a rejected draft on screen instead of discarding it.
  //
  // Every mutation funnels through here, guarded or not: `mutate` wraps a plain write as an
  // already-successful result, so there is one place that owns the ticket, the in-flight count
  // and what gets applied.
  const mutateResult = useCallback(
    async (
      action: () => Promise<TextFieldSaveResult>,
    ): Promise<TextSaveOutcome> => {
      const ticket = ++latestTicket.current
      inFlight.current += 1
      setSaving(true)
      setError(null)
      try {
        const result = await action()
        const applied =
          result.issue.id === issueId
            ? result.issue
            : await deps.getIssue(issueId)
        // Drop a stale read. bd serializes writes, so a later mutation's read already
        // contains this one's write; applying this older snapshot on top would undo it.
        // Without the ticket the LAST-RESOLVING call wins, which is whichever bd process
        // happened to finish last rather than the edit the user made last.
        if (ticket === latestTicket.current) setIssue(applied)
        // A conflict wrote nothing, so nothing downstream went stale — but the rail now shows
        // the text that IS stored, which is what the editor's notice offers to reconcile with.
        if (!result.ok)
          return { saved: false, storedText: result.conflict.current }
        // The write itself did land either way, so the list is stale either way.
        onMutated?.()
        return { saved: true }
      } catch (e) {
        // A failure is reported even when a later mutation has superseded it: the state it
        // describes (a write that did not happen) is not something the newer read can correct.
        setError(messageOf(e))
        return { saved: false }
      } finally {
        inFlight.current -= 1
        if (inFlight.current === 0) setSaving(false)
      }
    },
    [deps, issueId, onMutated],
  )

  /** The unguarded path: every write that replaces a value the reader picked from what the
   * screen already showed, so there is nothing underneath it to lose. */
  const mutate = useCallback(
    async (action: () => Promise<ShowIssue>): Promise<boolean> =>
      (await mutateResult(async () => ({ ok: true, issue: await action() })))
        .saved,
    [mutateResult],
  )

  /** The guarded path: one whole-field text write, refused rather than landed when the stored
   * text is no longer the `baseline` the editor opened with (pm-beads-6d5). */
  const saveText = useCallback(
    (
      field: GuardedTextField,
      value: string,
      baseline: string,
    ): Promise<TextSaveOutcome> =>
      mutateResult(() => deps.saveTextField(issueId, field, value, baseline)),
    [deps, issueId, mutateResult],
  )

  const actions = {
    answerAsk: (key: string, answer: string | null) =>
      mutate(() => deps.answerAsk(issueId, key, answer)),
    setStatus: (status: string) =>
      mutate(() => deps.updateIssue(issueId, { status })),
    setPriority: (priority: number) =>
      mutate(() => deps.updateIssue(issueId, { priority })),
    setAssignee: (assignee: string) =>
      mutate(() => deps.updateIssue(issueId, { assignee })),
    // The five whole-field text writes. Each takes the `baseline` its editor opened with, which
    // is not optional: a caller that cannot say what it believed the field held has no way to
    // tell its own edit from an overwrite of someone else's.
    //
    // Titles carry no markdown, so the surrounding whitespace of an inline edit is noise.
    // bd rejects an empty title outright ("title cannot be empty"); refusing it here keeps the
    // message ours and spares the round trip.
    setTitle: async (
      title: string,
      baseline: string,
    ): Promise<TextSaveOutcome> => {
      const trimmed = title.trim()
      if (trimmed === '') {
        setError('Title cannot be empty')
        return { saved: false }
      }
      return saveText('title', trimmed, baseline)
    },
    // Never trimmed: trailing spaces are a markdown hard line break, and an empty string is a
    // deliberate clear, which bd honours on --description (verified on bd 1.2.2).
    setDescription: (description: string, baseline: string) =>
      saveText('description', description, baseline),
    // The other three bd long-text fields, on the same terms as the description. One setter per
    // field rather than one taking a field name, so a caller cannot pass a field bd has no flag
    // for and only find out at the CLI.
    setDesign: (design: string, baseline: string) =>
      saveText('design', design, baseline),
    setAcceptanceCriteria: (acceptance_criteria: string, baseline: string) =>
      saveText('acceptance_criteria', acceptance_criteria, baseline),
    setNotes: (notes: string, baseline: string) =>
      saveText('notes', notes, baseline),
    setType: (issue_type: string) =>
      mutate(() => deps.updateIssue(issueId, { issue_type })),
    addLabel: (label: string) => mutate(() => deps.addLabel(issueId, label)),
    removeLabel: (label: string) =>
      mutate(() => deps.removeLabel(issueId, label)),
    close: (reason?: string) => mutate(() => deps.closeIssue(issueId, reason)),
    // Dependency writes return the edge owner's fresh issue. On error (cycle/duplicate/self)
    // mutate sets `error` and leaves local state unchanged — no optimistic mutation. The caller
    // passes ids already in dependency-meta's order.
    addDependency: (depIssueId: string, dependsOnId: string, type: string) =>
      mutate(() => deps.addDependency(depIssueId, dependsOnId, type)),
    removeDependency: (depIssueId: string, dependsOnId: string) =>
      mutate(() => deps.removeDependency(depIssueId, dependsOnId)),
    relate: (a: string, b: string) => mutate(() => deps.relate(a, b)),
    unrelate: (a: string, b: string) => mutate(() => deps.unrelate(a, b)),
    // A ref the server can't resolve (a bare number with no GitHub origin remote) rejects, so
    // mutate surfaces bd's/git's own message on the rail's error line and leaves state alone.
    setPrUrl: (ref: string) => mutate(() => deps.setPrUrl(issueId, ref)),
    clearPrUrl: () => mutate(() => deps.clearPrUrl(issueId)),
  }

  return {
    issue,
    saving,
    error,
    actions,
    listCandidates: deps.listCandidates,
    getPrState: deps.getPrState,
  }
}
