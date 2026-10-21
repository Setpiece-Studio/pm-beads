// ABOUTME: Shared markdown source editor for bd long-text fields — @uiw/react-md-editor (a plain
// ABOUTME: textarea) mounted client-only, previewing through our own Markdown so bead chips render.

import type { CSSProperties } from 'react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Markdown } from '@/components/ui/markdown'
import { cn } from '@/lib/utils'

// The `/common` entry carries the highlight overlay: the source is mirrored into a <pre> that
// colours the markdown while the textarea above it paints its own text transparent. It also
// builds its TextArea with `useMinHeight`, which is what lets `height="auto"` below size the
// editor to its content instead of to a fixed box.
//
// Loading it lazily is what keeps it off the server: it reads `document` on mount and does not
// server-render, so a static import would hydration-error under TanStack Start. The dynamic
// import is only evaluated once `mounted` is true, i.e. never during SSR.
const MDEditor = lazy(() => import('@uiw/react-md-editor/common'))

export interface MarkdownEditorProps {
  /** Markdown source. Controlled — the host owns the draft. */
  value: string
  onChange: (value: string) => void
  /** Cmd/Ctrl+Enter. Omitted where the host saves some other way (a button, a blur). */
  onSave?: () => void
  /** Escape. */
  onCancel?: () => void
  /** Focus left the editor for something outside it. Moving between the textarea, the toolbar
   * and the preview stays inside, so a host that saves on blur doesn't have to know the
   * editor's internals. */
  onBlurOutside?: () => void
  /** Blocks typing while a save is in flight; the draft stays on screen. */
  disabled?: boolean
  /** Accessible name for the textarea — the field being edited ("Description", "Notes"). */
  label: string
  placeholder?: string
  /** Shortest the editor gets, in px, however little is typed. */
  minHeight?: number
  /** Tallest it grows before the source scrolls inside it, in px. A long description should not
   * push the save affordance and the rest of the page off the screen. */
  maxHeight?: number
  autoFocus?: boolean
  className?: string
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onCancel,
  onBlurOutside,
  disabled,
  label,
  placeholder,
  minHeight = 120,
  maxHeight = 640,
  autoFocus,
  className,
}: MarkdownEditorProps) {
  const [mounted, setMounted] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // Read through refs so the native listeners stay attached across re-renders.
  const onSaveRef = useRef(onSave)
  const onCancelRef = useRef(onCancel)
  const onBlurOutsideRef = useRef(onBlurOutside)
  onSaveRef.current = onSave
  onCancelRef.current = onCancel
  onBlurOutsideRef.current = onBlurOutside

  useEffect(() => setMounted(true), [])

  // The library binds its own NATIVE keydown listener on the textarea and calls
  // stopPropagation() whenever it handles a key — including Enter on a list line, which it
  // continues. A React onKeyDown would therefore never see Cmd+Enter inside a list. A
  // capture-phase listener on the wrapper runs before the textarea's own, so save and cancel
  // win; every other key falls through to the library untouched.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const handle = (event: KeyboardEvent) => {
      const save = onSaveRef.current
      const cancel = onCancelRef.current
      if (save && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        event.stopPropagation()
        save()
        return
      }
      if (cancel && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()
      }
    }
    root.addEventListener('keydown', handle, true)
    return () => root.removeEventListener('keydown', handle, true)
    // The wrapper is rendered from the first paint, so one attach covers the editor's whole life.
  }, [])

  // focusout rather than React's onBlur: the toolbar, the drag bar and the preview are all
  // inside the editor, and only a move OUT of it is a blur as far as the host is concerned.
  //
  // `relatedTarget` is not enough to decide that. Several toolbar controls replace the editor's
  // own subtree — pressing Preview unmounts the textarea outright — so focus is DESTROYED rather
  // than moved and relatedTarget arrives null, which read as "focus left" and closed the editor
  // mid-edit. Reading `document.activeElement` a frame later asks where focus actually settled.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const handle = () => {
      requestAnimationFrame(() => {
        // The editor may have been unmounted by the host in the meantime.
        if (!root.isConnected) return
        const active = document.activeElement
        // Focus landed on nothing: the element holding it was removed, which is a toolbar press
        // rebuilding the editor, not a blur. Erring this way costs an autosave when the reader
        // clicks dead space — they still have ⌘↵, Esc, and any real control — where erring the
        // other way discards the editor under them on a Preview press.
        if (!active || active === document.body) return
        if (root.contains(active)) return
        onBlurOutsideRef.current?.()
      })
    }
    root.addEventListener('focusout', handle)
    return () => root.removeEventListener('focusout', handle)
  }, [])

  // Same body the detail page renders read-only: what SSR emits, and what stands in while the
  // editor chunk loads, so the block never collapses to nothing mid-edit.
  const readOnly = (
    <div data-slot="markdown-editor-pending">
      <Markdown>{value}</Markdown>
    </div>
  )

  return (
    <div
      ref={rootRef}
      data-slot="markdown-editor"
      className={cn('min-w-0', className)}
      // The bounds live in CSS because the element they have to constrain is the library's own
      // inner scroll container, which we never render and so cannot style inline.
      style={
        {
          '--md-editor-min-height': `${minHeight}px`,
          '--md-editor-max-height': `${maxHeight}px`,
        } as CSSProperties
      }
    >
      {mounted ? (
        <Suspense fallback={readOnly}>
          <MDEditor
            value={value}
            onChange={(next) => onChange(next ?? '')}
            preview="edit"
            height="auto"
            autoFocus={autoFocus}
            textareaProps={{
              'aria-label': label,
              placeholder,
              disabled,
            }}
            components={{
              // Without this the editor renders its own markdown and bead references come out
              // as dead text. Ours runs remarkGfm + remarkBeadLinks and renders BeadChips.
              preview: (source) => (
                <div
                  data-testid="markdown-editor-preview"
                  className="min-w-0 px-1 py-1"
                >
                  <Markdown>{source}</Markdown>
                </div>
              ),
            }}
          />
        </Suspense>
      ) : (
        readOnly
      )}
    </div>
  )
}
