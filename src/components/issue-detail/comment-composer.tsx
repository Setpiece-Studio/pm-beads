// ABOUTME: The "Leave a comment…" card at the foot of the activity stream — an auto-growing
// ABOUTME: textarea with a send arrow, submitting on click or Ctrl/Cmd+Enter.

import { ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { MentionTextarea } from '@/components/mentions/mention-textarea'
import { cn } from '@/lib/utils'

export interface CommentComposerProps {
  /** Posts the comment. Rejecting leaves the draft in place so nothing is lost. */
  onSubmit: (text: string) => Promise<void>
  disabled?: boolean
}

export function CommentComposer({ onSubmit, disabled }: CommentComposerProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = text.trim()
  const canSend = trimmed !== '' && !sending && !disabled

  async function submit() {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      await onSubmit(trimmed)
      // Clear only on success — a failed post keeps the draft for a retry.
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="rounded-md border bg-background focus-within:border-ring/70">
        <MentionTextarea
          aria-label="Leave a comment"
          placeholder="Leave a comment…"
          rows={2}
          value={text}
          disabled={disabled}
          onChange={setText}
          // Ctrl/Cmd+Enter sends; a bare Enter stays a newline so multi-line comments work.
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void submit()
            }
          }}
          className="min-h-14 w-full resize-y bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          <button
            type="button"
            aria-label="Send comment"
            disabled={!canSend}
            onClick={() => void submit()}
            className={cn(
              'flex size-6 items-center justify-center rounded-full transition-colors',
              canSend
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <ArrowUp className="size-3.5" />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}
