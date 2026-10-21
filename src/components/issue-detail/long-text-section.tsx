// ABOUTME: One editable long-text field on the issue body — rendered markdown that becomes the
// ABOUTME: shared MarkdownEditor on click, saving through the detail hook's matching action.

import { Pencil } from 'lucide-react'
import { type MouseEvent, useRef, useState } from 'react'
import { Markdown } from '@/components/ui/markdown'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import { cn } from '@/lib/utils'
import { SectionHeading } from './detail-chrome'
import type { TextSaveOutcome } from './use-issue-edits'

/** The bd long-text fields the issue body renders, in the order they appear. `description` is the
 * body itself and carries no heading; the rest are named sections beneath it. */
export const LONG_TEXT_FIELDS = [
  'description',
  'design',
  'acceptance_criteria',
  'notes',
] as const

export type LongTextField = (typeof LONG_TEXT_FIELDS)[number]

export const LONG_TEXT_LABELS: Record<LongTextField, string> = {
  description: 'Description',
  design: 'Design',
  acceptance_criteria: 'Acceptance criteria',
  notes: 'Notes',
}

const PLACEHOLDERS: Record<LongTextField, string> = {
  description: 'Describe this issue…',
  design: 'How should this be built?',
  acceptance_criteria: 'What has to be true for this to be done?',
  notes: 'Anything else worth keeping with this issue…',
}

export interface LongTextSectionProps {
  field: LongTextField
  value?: string
  /** Writes the draft over `baseline` — the text this editor opened with. Resolves unsaved when
   * the write was refused, so the draft stays on screen for a retry: the same bargain
   * CommentComposer makes with a failed post. A refusal carrying `storedText` is a concurrent
   * rewrite, and that text is what the draft would have erased. */
  onSave: (value: string, baseline: string) => Promise<TextSaveOutcome>
  /** True while any rail mutation is in flight; blocks typing without dropping the draft. */
  saving?: boolean
  /** Open in the editor on mount. Set when the reader reached this field through the add menu,
   * which has already said they intend to write in it. */
  autoEdit?: boolean
  /** Called when an empty field is left empty, so the host can drop it back out of the body. */
  onAbandon?: () => void
}

export function LongTextSection({
  field,
  value,
  onSave,
  saving,
  autoEdit,
  onAbandon,
}: LongTextSectionProps) {
  const [editing, setEditing] = useState(autoEdit ?? false)
  const [draft, setDraft] = useState(value ?? '')
  // The text this editor opened on — what the reader demonstrably read before typing over it,
  // and what the save is allowed to replace. Not the same as `value`, which can move underneath
  // an open editor when a concurrent write lands on the rail.
  const baseline = useRef(value ?? '')
  // What the field says now, set when a save was refused because it had moved. Non-null means
  // the draft is unsaved and the reader has a decision to make.
  const [storedText, setStoredText] = useState<string | null>(null)
  // Leaving the editor saves, which means both Esc and a successful save would re-enter through
  // the ensuing focusout. `closing` marks an exit that has already been decided.
  const closing = useRef(false)
  const committing = useRef(false)

  const current = value ?? ''
  const label = LONG_TEXT_LABELS[field]
  const heading = field === 'description' ? null : label

  function startEditing() {
    closing.current = false
    baseline.current = current
    setStoredText(null)
    setDraft(current)
    setEditing(true)
  }

  function finishEditing() {
    closing.current = true
    setStoredText(null)
    setEditing(false)
    // An optional section the reader opened and then left blank should not linger as an empty
    // heading; the host drops it and the add menu offers it again.
    if (current.trim() === '') onAbandon?.()
  }

  /** `against` overrides the baseline — the notice's Overwrite press, which is a decision about
   * the text the reader was just shown rather than a blind retry. */
  async function commit(against?: string) {
    if (committing.current) return
    // Nothing typed: leaving the editor is not a reason to spend a bd write.
    if (draft === current) {
      finishEditing()
      return
    }
    committing.current = true
    try {
      const outcome = await onSave(draft, against ?? baseline.current)
      if (outcome.saved) {
        // Not finishEditing: a draft that just filled an empty optional section must not be
        // read as the reader abandoning it.
        closing.current = true
        setStoredText(null)
        setEditing(false)
        return
      }
      // A refusal always keeps the draft. When it names the text that displaced the baseline,
      // the notice shows it so the reader can merge or overwrite instead of hitting a wall.
      if (outcome.storedText !== undefined) setStoredText(outcome.storedText)
    } finally {
      committing.current = false
    }
  }

  function cancel() {
    finishEditing()
  }

  function handleBlurOutside() {
    // Esc and a landed save both take focus out of the editor; neither is a reason to save again.
    if (closing.current) return
    // An unresolved conflict cannot be settled by walking away: the baseline is stale by
    // definition, so another save would only be refused again. The draft waits instead.
    if (storedText !== null) return
    void commit()
  }

  function handleDisplayClick(event: MouseEvent<HTMLElement>) {
    // Bead chips and authored links are real links — following one must not open the editor.
    if ((event.target as HTMLElement).closest('a')) return
    // A click that ends a text selection is a copy, not an edit.
    if (window.getSelection()?.toString()) return
    startEditing()
  }

  if (editing) {
    return (
      <section
        data-testid={`${field}-editor`}
        className="flex flex-col gap-1.5"
      >
        {heading && <SectionHeading>{heading}</SectionHeading>}
        {storedText !== null && (
          <div
            data-testid={`${field}-conflict`}
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs"
          >
            <p className="font-medium text-foreground">
              This {label.toLowerCase()} changed while you had it open — your
              draft was not saved.
            </p>
            <div className="max-h-48 overflow-y-auto rounded-sm border border-border bg-background px-2 py-1.5">
              {storedText.trim() === '' ? (
                <p className="text-muted-foreground">It is empty now.</p>
              ) : (
                <Markdown>{storedText}</Markdown>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => void commit(storedText)}
                className="rounded-md border border-border px-2 py-1 font-medium transition-colors hover:bg-accent hover:text-foreground"
              >
                Overwrite with my version
              </button>
              <span className="text-muted-foreground">
                or copy what you need into your draft. Esc keeps theirs.
              </span>
            </div>
          </div>
        )}
        <MarkdownEditor
          label={label}
          value={draft}
          onChange={setDraft}
          onSave={() => void commit()}
          onCancel={cancel}
          onBlurOutside={handleBlurOutside}
          disabled={saving}
          autoFocus
          placeholder={PLACEHOLDERS[field]}
        />
        <p className="text-xs text-muted-foreground">
          ⌘↵ to save · Esc to cancel
        </p>
      </section>
    )
  }

  // Only the description offers its own inline affordance — it is the body, so an issue without
  // one reads as unfinished. The optional sections are reached through the body's add menu
  // instead, which keeps three permanent "Add …" stubs off every issue.
  if (current.trim() === '') {
    if (field !== 'description') return null
    return (
      <button
        type="button"
        data-testid="description-add"
        onClick={startEditing}
        className="self-start rounded-md px-1 py-0.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Add description…
      </button>
    )
  }

  return (
    <section className="flex flex-col gap-1.5">
      {heading && <SectionHeading>{heading}</SectionHeading>}
      <div className="group relative">
        {/* The pencil is the keyboard and screen-reader path into the editor; clicking the body
            itself is a mouse convenience layered over it. Making the body a button instead would
            swallow the bead chips and links inside it, so the two rules are waived here rather
            than solved by giving a block of prose a button role. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: see above — the Edit button is the interactive element. */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: see above — the Edit button carries the keyboard path. */}
        <div
          data-testid={`${field}-display`}
          onClick={handleDisplayClick}
          className="cursor-text"
        >
          <Markdown>{current}</Markdown>
        </div>
        <button
          type="button"
          aria-label={`Edit ${label.toLowerCase()}`}
          onClick={startEditing}
          className={cn(
            'absolute right-0 top-0 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity',
            'hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100',
          )}
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
    </section>
  )
}
