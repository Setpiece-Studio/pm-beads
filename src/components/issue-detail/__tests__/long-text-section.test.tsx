// ABOUTME: Tests for the editable long-text block, exercised through the description field — click-to-edit, the empty-state affordance,
// ABOUTME: save on Cmd+Enter and on leaving the editor, Esc cancelling, and a rejected save.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LongTextSection } from '../long-text-section'

afterEach(cleanup)

/** The editor arrives on a dynamic import. */
function editor() {
  return screen.findByLabelText('Description', undefined, { timeout: 15000 })
}

/** Leaving the editor has to be expressed as focus landing on something real outside it. A null
 * or body relatedTarget means focus was destroyed, which is a toolbar control rebuilding the
 * editor's subtree rather than the reader walking away. */
function leaveEditor(textarea: HTMLElement) {
  const outside = document.createElement('button')
  document.body.appendChild(outside)
  outside.focus()
  fireEvent.focusOut(textarea, { relatedTarget: outside })
  return () => outside.remove()
}

describe('LongTextSection', () => {
  it('renders the description as markdown until it is clicked', () => {
    render(
      <LongTextSection
        field="description"
        value="It needs **1.21 gigawatts**."
        onSave={vi.fn()}
      />,
    )

    const display = screen.getByTestId('description-display')
    expect(display.querySelector('strong')?.textContent).toBe('1.21 gigawatts')
    expect(screen.queryByTestId('description-editor')).toBeNull()
  })

  it('offers an add affordance when the description is empty', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: true })
    render(<LongTextSection field="description" value="" onSave={onSave} />)

    // An empty description used to render nothing at all, leaving no way in.
    fireEvent.click(screen.getByTestId('description-add'))
    const textarea = (await editor()) as HTMLTextAreaElement
    expect(textarea.value).toBe('')
  })

  it('opens the editor seeded with the current source on a body click', async () => {
    const source = '# Heading\n\nbody'
    render(
      <LongTextSection field="description" value={source} onSave={vi.fn()} />,
    )

    fireEvent.click(screen.getByTestId('description-display'))
    const textarea = (await editor()) as HTMLTextAreaElement
    // The editor is seeded with the markdown SOURCE, not the rendered text.
    expect(textarea.value).toBe(source)
  })

  it('opens the editor from the Edit button, for the keyboard path', async () => {
    render(
      <LongTextSection field="description" value="body" onSave={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit description' }))
    expect(await editor()).toBeDefined()
  })

  it('does not open the editor when the click followed a link', async () => {
    render(
      <LongTextSection
        field="description"
        value="see [the docs](https://example.com)"
        onSave={vi.fn()}
      />,
    )

    // jsdom implements no navigation, so the anchor's default action is suppressed the way the
    // browser's own follow would be — the assertion is about our handler, not about jsdom.
    const suppressNavigation = (event: Event) => event.preventDefault()
    document.addEventListener('click', suppressNavigation, true)
    fireEvent.click(screen.getByRole('link', { name: 'the docs' }))
    document.removeEventListener('click', suppressNavigation, true)

    expect(screen.queryByTestId('description-editor')).toBeNull()
  })

  it('saves on Cmd+Enter and returns to the rendered markdown', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: true })
    render(<LongTextSection field="description" value="old" onSave={onSave} />)

    fireEvent.click(screen.getByTestId('description-display'))
    const textarea = await editor()
    fireEvent.change(textarea, { target: { value: 'new body' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', metaKey: true })

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('new body', 'old'))
    await waitFor(() =>
      expect(screen.queryByTestId('description-editor')).toBeNull(),
    )
  })

  it('saves when focus leaves the editor entirely', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: true })
    render(<LongTextSection field="description" value="old" onSave={onSave} />)

    fireEvent.click(screen.getByTestId('description-display'))
    const textarea = await editor()
    fireEvent.change(textarea, { target: { value: 'blurred body' } })
    const done = leaveEditor(textarea)

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('blurred body', 'old'),
    )
    done()
  })

  it('does not save when focus moves to the editor toolbar', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: true })
    render(<LongTextSection field="description" value="old" onSave={onSave} />)

    fireEvent.click(screen.getByTestId('description-display'))
    const textarea = await editor()
    fireEvent.change(textarea, { target: { value: 'mid edit' } })
    // Clicking a toolbar button moves focus inside the editor; that is not leaving it.
    const bold = screen.getByRole('button', { name: /Add bold text/ })
    fireEvent.focusOut(textarea, { relatedTarget: bold })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('spends no write when the draft is unchanged', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: true })
    render(<LongTextSection field="description" value="old" onSave={onSave} />)

    fireEvent.click(screen.getByTestId('description-display'))
    const textarea = await editor()
    const done = leaveEditor(textarea)

    await waitFor(() =>
      expect(screen.queryByTestId('description-editor')).toBeNull(),
    )
    expect(onSave).not.toHaveBeenCalled()
    done()
  })

  it('cancels on Escape without writing and restores the original text', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: true })
    render(
      <LongTextSection field="description" value="original" onSave={onSave} />,
    )

    fireEvent.click(screen.getByTestId('description-display'))
    const textarea = await editor()
    fireEvent.change(textarea, { target: { value: 'discard me' } })
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' })

    await waitFor(() =>
      expect(screen.queryByTestId('description-editor')).toBeNull(),
    )
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('description-display').textContent).toContain(
      'original',
    )
  })

  it('keeps the draft in the editor when the save is refused', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: false })
    render(<LongTextSection field="description" value="old" onSave={onSave} />)

    fireEvent.click(screen.getByTestId('description-display'))
    const textarea = await editor()
    fireEvent.change(textarea, { target: { value: 'unsaved work' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', metaKey: true })

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('unsaved work', 'old'),
    )
    // Nothing is lost: the editor stays open on the rejected draft.
    expect(screen.getByTestId('description-editor')).toBeDefined()
    expect((await editor()) as HTMLTextAreaElement).toHaveProperty(
      'value',
      'unsaved work',
    )
  })

  // pm-beads-6d5: the save replaces the whole field, so a draft written over text an agent
  // rewrote mid-edit would erase it. The editor sends the text it opened with and, when that is
  // no longer what bd holds, keeps the draft and shows what it would have overwritten.
  describe('when the field changed underneath the editor', () => {
    /** A conflict: refused, with the text bd actually holds now. */
    function conflictWith(storedText: string) {
      return { saved: false, storedText }
    }

    it('keeps the draft and shows what the field says now', async () => {
      const onSave = vi
        .fn()
        .mockResolvedValue(conflictWith('the agent wrote this'))
      render(
        <LongTextSection field="description" value="old" onSave={onSave} />,
      )

      fireEvent.click(screen.getByTestId('description-display'))
      const textarea = await editor()
      fireEvent.change(textarea, { target: { value: 'my draft' } })
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        code: 'Enter',
        metaKey: true,
      })

      const notice = await screen.findByTestId('description-conflict')
      expect(notice.textContent).toContain('the agent wrote this')
      // Nothing is lost: the draft is still in the editor, exactly as a refused save leaves it.
      expect((await editor()) as HTMLTextAreaElement).toHaveProperty(
        'value',
        'my draft',
      )
    })

    it('overwrites on an explicit press, against the text it was shown', async () => {
      const onSave = vi
        .fn()
        .mockResolvedValueOnce(conflictWith('the agent wrote this'))
        .mockResolvedValueOnce({ saved: true })
      render(
        <LongTextSection field="description" value="old" onSave={onSave} />,
      )

      fireEvent.click(screen.getByTestId('description-display'))
      const textarea = await editor()
      fireEvent.change(textarea, { target: { value: 'my draft' } })
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        code: 'Enter',
        metaKey: true,
      })
      await screen.findByTestId('description-conflict')

      fireEvent.click(screen.getByRole('button', { name: /Overwrite/ }))

      // The retry carries the text the notice showed as its baseline, so it is a decision about
      // what the reader actually saw rather than a blind second attempt.
      await waitFor(() =>
        expect(onSave).toHaveBeenLastCalledWith(
          'my draft',
          'the agent wrote this',
        ),
      )
      await waitFor(() =>
        expect(screen.queryByTestId('description-editor')).toBeNull(),
      )
    })

    it('does not save on the way out while the conflict stands', async () => {
      const onSave = vi.fn().mockResolvedValue(conflictWith('theirs'))
      render(
        <LongTextSection field="description" value="old" onSave={onSave} />,
      )

      fireEvent.click(screen.getByTestId('description-display'))
      const textarea = await editor()
      fireEvent.change(textarea, { target: { value: 'my draft' } })
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        code: 'Enter',
        metaKey: true,
      })
      await screen.findByTestId('description-conflict')

      // Leaving the editor cannot resolve a conflict — the baseline is stale by definition —
      // so it must not spend a second write, and must not close on the unsaved draft.
      const done = leaveEditor(textarea)
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(screen.getByTestId('description-editor')).toBeDefined()
      done()
    })

    it('drops the notice when the editor is opened again', async () => {
      const onSave = vi.fn().mockResolvedValue(conflictWith('theirs'))
      render(
        <LongTextSection field="description" value="old" onSave={onSave} />,
      )

      fireEvent.click(screen.getByTestId('description-display'))
      const textarea = await editor()
      fireEvent.change(textarea, { target: { value: 'my draft' } })
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        code: 'Enter',
        metaKey: true,
      })
      await screen.findByTestId('description-conflict')

      // Escape discards the draft; the next edit starts from the text now on screen.
      fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' })
      await waitFor(() =>
        expect(screen.queryByTestId('description-editor')).toBeNull(),
      )
      fireEvent.click(screen.getByTestId('description-display'))
      await editor()

      expect(screen.queryByTestId('description-conflict')).toBeNull()
    })
  })

  it('clears the description when the draft is emptied', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: true })
    render(
      <LongTextSection field="description" value="delete me" onSave={onSave} />,
    )

    fireEvent.click(screen.getByTestId('description-display'))
    const textarea = await editor()
    fireEvent.change(textarea, { target: { value: '' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', metaKey: true })

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('', 'delete me'))
  })

  it('disables the editor while a rail mutation is in flight', async () => {
    render(
      <LongTextSection
        field="description"
        value="body"
        onSave={vi.fn()}
        saving={false}
      />,
    )
    fireEvent.click(screen.getByTestId('description-display'))
    await editor()

    cleanup()
    render(
      <LongTextSection
        field="description"
        value="body"
        onSave={vi.fn()}
        saving
      />,
    )
    fireEvent.click(screen.getByTestId('description-display'))
    const textarea = (await editor()) as HTMLTextAreaElement
    expect(textarea.disabled).toBe(true)
  })
})

describe('LongTextSection on the optional fields', () => {
  it('renders a heading and saves through the field it was given', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: true })
    render(
      <LongTextSection
        field="acceptance_criteria"
        value="- [ ] one"
        onSave={onSave}
      />,
    )

    expect(screen.getByText('Acceptance criteria')).toBeDefined()
    fireEvent.click(screen.getByTestId('acceptance_criteria-display'))

    const textarea = await screen.findByLabelText(
      'Acceptance criteria',
      undefined,
      { timeout: 15000 },
    )
    fireEvent.change(textarea, { target: { value: '- [x] one' } })
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', metaKey: true })

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith('- [x] one', '- [ ] one'),
    )
  })

  it('stays out of the body entirely when empty, unlike the description', () => {
    const { container } = render(
      <LongTextSection field="notes" onSave={vi.fn()} />,
    )
    // No "Add notes…" stub: an empty optional field is reached through the add menu instead.
    expect(container.firstChild).toBeNull()
  })

  it('opens straight into the editor when reached from the add menu', async () => {
    render(<LongTextSection field="design" onSave={vi.fn()} autoEdit />)
    expect(
      await screen.findByLabelText('Design', undefined, { timeout: 15000 }),
    ).toBeDefined()
  })

  it('tells the host to drop an empty section left untouched', async () => {
    const onAbandon = vi.fn()
    render(
      <LongTextSection
        field="design"
        onSave={vi.fn()}
        autoEdit
        onAbandon={onAbandon}
      />,
    )

    const textarea = await screen.findByLabelText('Design', undefined, {
      timeout: 15000,
    })
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' })

    await waitFor(() => expect(onAbandon).toHaveBeenCalledTimes(1))
  })
})
