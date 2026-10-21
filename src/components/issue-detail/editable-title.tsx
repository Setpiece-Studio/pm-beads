// ABOUTME: The issue detail heading — a click-to-edit single-line input inside the h1, keeping
// ABOUTME: the heading itself the mount-focus target for keyboard and screen-reader users.

import { type KeyboardEvent, type RefObject, useRef, useState } from 'react'
import type { TextSaveOutcome } from './use-issue-edits'

export interface EditableTitleProps {
  title: string
  /** Writes the draft over `baseline` — the title this editor opened with. Resolves unsaved when
   * the write was refused or the title was blank, so the editor stays open on the draft. A
   * refusal carrying `storedText` is a concurrent rename, and that is the name it would have
   * replaced. */
  onSave: (title: string, baseline: string) => Promise<TextSaveOutcome>
  /** True while any rail mutation is in flight. */
  saving?: boolean
  /** The detail shell focuses the heading on mount; the edit affordance must not take that over. */
  headingRef: RefObject<HTMLHeadingElement | null>
}

export function EditableTitle({
  title,
  onSave,
  saving,
  headingRef,
}: EditableTitleProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // The name this editor opened on — what the reader read before renaming it, and the only
  // title this save is allowed to replace.
  const baseline = useRef(title)
  // The name the issue carries now, set when a save was refused because it had moved.
  const [storedText, setStoredText] = useState<string | null>(null)
  // Enter and Escape both leave the input, and leaving it saves; `closing` marks an exit whose
  // outcome is already decided so the ensuing blur does nothing.
  const closing = useRef(false)
  const committing = useRef(false)

  function startEditing() {
    closing.current = false
    baseline.current = title
    setStoredText(null)
    setDraft(title)
    setEditing(true)
  }

  function cancel() {
    closing.current = true
    setStoredText(null)
    setEditing(false)
    headingRef.current?.focus()
  }

  /** `against` overrides the baseline — the notice's Overwrite press, which is a decision about
   * the name the reader was just shown. */
  async function commit(against?: string) {
    if (committing.current) return
    // An empty title is not a write bd will take, and blanking one is never the intent of a
    // click into the heading — keep the editor open rather than discarding the name.
    if (draft.trim() === '') return
    if (draft.trim() === title) {
      closing.current = true
      setEditing(false)
      return
    }
    committing.current = true
    try {
      const outcome = await onSave(draft, against ?? baseline.current)
      if (outcome.saved) {
        closing.current = true
        setStoredText(null)
        setEditing(false)
        return
      }
      if (outcome.storedText !== undefined) setStoredText(outcome.storedText)
    } finally {
      committing.current = false
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }

  const heading = (
    // tabIndex makes the heading a programmatic focus target on mount.
    <h1
      ref={headingRef}
      tabIndex={-1}
      className="text-xl font-semibold leading-snug outline-none"
    >
      {editing ? (
        <input
          aria-label="Issue title"
          // biome-ignore lint/a11y/noAutofocus: the input exists only because the user just asked to type in it.
          autoFocus
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (closing.current) return
            // An unresolved conflict cannot be settled by leaving: the baseline is stale by
            // definition, so another save would only be refused again.
            if (storedText !== null) return
            void commit()
          }}
          className="w-full rounded-sm bg-transparent text-xl font-semibold leading-snug outline-none ring-1 ring-ring/50"
        />
      ) : (
        <button
          type="button"
          data-testid="issue-title"
          title="Click to rename"
          onClick={startEditing}
          className="w-full rounded-sm text-left transition-colors hover:bg-accent/50"
        >
          {title}
        </button>
      )}
    </h1>
  )

  // The notice sits OUTSIDE the heading: an h1 takes phrasing content only, and anything
  // inside it joins the heading's accessible name — which is already the hazard that makes
  // `heading { name }` unusable against an open title editor.
  return (
    <>
      {heading}
      {editing && storedText !== null && (
        <div
          data-testid="title-conflict"
          role="alert"
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs"
        >
          <span>
            Renamed to <strong className="font-medium">{storedText}</strong>{' '}
            while you had it open — your rename was not saved.
          </span>
          <button
            type="button"
            onClick={() => void commit(storedText)}
            className="rounded-md border border-border px-2 py-1 font-medium transition-colors hover:bg-accent hover:text-foreground"
          >
            Overwrite with my version
          </button>
        </div>
      )}
    </>
  )
}
