// ABOUTME: Tests for the shared MarkdownEditor — the client-only mount, edits, the save/cancel
// ABOUTME: keys that must beat the library's own textarea handler, and the overridden preview.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownEditor } from '../markdown-editor'

afterEach(cleanup)

/** The editor arrives on a dynamic import, so every assertion on it waits for the textarea. The
 * first await in the file pays for transforming the library, which outlasts findBy's 1s default
 * when the whole suite is running. */
function editorTextarea() {
  return screen.findByLabelText('Description', undefined, { timeout: 15000 })
}

/** The blur decision is deferred a frame so it can read where focus actually settled rather than
 * trusting relatedTarget, which several toolbar controls leave null. */
function nextFrame() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => resolve(undefined)),
  )
}

describe('MarkdownEditor', () => {
  it('renders the read-only markdown until the client-only editor has mounted', () => {
    const { container } = render(
      <MarkdownEditor
        label="Description"
        value="# Heading"
        onChange={() => {}}
      />,
    )

    // The first paint — the server's output, and the client's pre-hydration render — is the
    // same read-only body the detail page shows, so nothing collapses while the chunk loads.
    expect(container.querySelector('[data-slot="markdown"]')).not.toBeNull()
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('seeds the textarea with the value and reports edits through onChange', async () => {
    const onChange = vi.fn()
    render(
      <MarkdownEditor label="Description" value="first" onChange={onChange} />,
    )

    const textarea = (await editorTextarea()) as HTMLTextAreaElement
    expect(textarea.value).toBe('first')

    fireEvent.change(textarea, { target: { value: 'second' } })
    expect(onChange).toHaveBeenCalledWith('second')
  })

  it('saves on Cmd/Ctrl+Enter and cancels on Escape', async () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <MarkdownEditor
        label="Description"
        value="body"
        onChange={() => {}}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    const textarea = await editorTextarea()

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', metaKey: true })
    expect(onSave).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('saves on Cmd+Enter from a list line, which the library would otherwise continue', async () => {
    const onSave = vi.fn()
    const onChange = vi.fn()
    render(
      <MarkdownEditor
        label="Description"
        value="- one"
        onChange={onChange}
        onSave={onSave}
      />,
    )

    const textarea = (await editorTextarea()) as HTMLTextAreaElement
    textarea.setSelectionRange(5, 5)
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', metaKey: true })

    // The library's native keydown listener continues the list on a bare Enter. Our capture-phase
    // handler runs first and stops the event, so Cmd+Enter saves instead of inserting "\n- ".
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('leaves a plain Enter to the library so list continuation still works', async () => {
    const onSave = vi.fn()
    render(
      <MarkdownEditor
        label="Description"
        value="- one"
        onSave={onSave}
        onChange={() => {}}
      />,
    )

    const textarea = await editorTextarea()
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('renders the preview through our own Markdown component, bead chips and all', async () => {
    render(
      <MarkdownEditor
        label="Description"
        value="see pm-beads-abc for context"
        onChange={() => {}}
      />,
    )
    await editorTextarea()

    fireEvent.click(screen.getByRole('button', { name: /Preview code/ }))

    // Our renderer marks its output; the library's bundled preview does not.
    const preview = await screen.findByTestId('markdown-editor-preview')
    expect(preview.querySelector('[data-slot="markdown"]')).not.toBeNull()
  })

  it('reports onBlurOutside only when focus leaves the editor for good', async () => {
    const onBlurOutside = vi.fn()
    // A focusable element outside the editor, so "left for good" can be expressed as real focus
    // rather than as a relatedTarget the component is no longer allowed to trust.
    const outside = document.createElement('button')
    document.body.appendChild(outside)

    render(
      <MarkdownEditor
        label="Description"
        value="body"
        onChange={() => {}}
        onBlurOutside={onBlurOutside}
      />,
    )

    const textarea = await editorTextarea()

    // The toolbar is part of the editor: reaching for Bold is not leaving it.
    const bold = screen.getByRole('button', { name: /Add bold text/ })
    bold.focus()
    fireEvent.focusOut(textarea, { relatedTarget: bold })
    await nextFrame()
    expect(onBlurOutside).not.toHaveBeenCalled()

    // Pressing Preview unmounts the textarea, so focus is DESTROYED rather than moved and
    // relatedTarget arrives null. That is a toolbar press, not a blur — treating it as one
    // discarded the editor mid-edit (pm-beads-dismiss regression).
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.focusOut(textarea, { relatedTarget: null })
    await nextFrame()
    expect(onBlurOutside).not.toHaveBeenCalled()

    outside.focus()
    fireEvent.focusOut(textarea, { relatedTarget: outside })
    await nextFrame()
    expect(onBlurOutside).toHaveBeenCalledTimes(1)

    outside.remove()
  })

  it('disables the textarea while a save is in flight', async () => {
    render(
      <MarkdownEditor
        label="Description"
        value="body"
        onChange={() => {}}
        disabled
      />,
    )

    const textarea = (await editorTextarea()) as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
  })
})
