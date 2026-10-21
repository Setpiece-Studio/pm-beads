// ABOUTME: Tests for the inline issue title — click to edit, Enter saves, Esc cancels, blank
// ABOUTME: titles are refused, and the heading stays the mount-focus target throughout.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditableTitle } from '../editable-title'
import type { TextSaveOutcome } from '../use-issue-edits'

afterEach(cleanup)

function renderTitle(
  overrides: {
    title?: string
    onSave?: (title: string, baseline: string) => Promise<TextSaveOutcome>
    saving?: boolean
  } = {},
) {
  const headingRef = createRef<HTMLHeadingElement>()
  const onSave = overrides.onSave ?? vi.fn().mockResolvedValue({ saved: true })
  render(
    <EditableTitle
      title={overrides.title ?? 'Fix the flux capacitor'}
      onSave={onSave}
      saving={overrides.saving}
      headingRef={headingRef}
    />,
  )
  return { headingRef, onSave }
}

describe('EditableTitle', () => {
  it('renders the title in a heading the shell can focus on mount', () => {
    const { headingRef } = renderTitle()

    const heading = screen.getByRole('heading', {
      name: 'Fix the flux capacitor',
    })
    expect(headingRef.current).toBe(heading)
    expect(heading.getAttribute('tabindex')).toBe('-1')
    // The heading, not the affordance inside it, is what the shell focuses.
    headingRef.current?.focus()
    expect(document.activeElement).toBe(heading)
  })

  it('opens an input seeded with the title when clicked', () => {
    renderTitle()

    fireEvent.click(screen.getByTestId('issue-title'))
    const input = screen.getByLabelText('Issue title') as HTMLInputElement
    expect(input.value).toBe('Fix the flux capacitor')
  })

  it('saves on Enter and returns to the heading', async () => {
    const { onSave } = renderTitle()

    fireEvent.click(screen.getByTestId('issue-title'))
    const input = screen.getByLabelText('Issue title')
    fireEvent.change(input, { target: { value: 'Rebuild the flux capacitor' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'Rebuild the flux capacitor',
        'Fix the flux capacitor',
      ),
    )
    await waitFor(() =>
      expect(screen.queryByLabelText('Issue title')).toBeNull(),
    )
  })

  it('cancels on Escape without writing and restores the title', () => {
    const { onSave, headingRef } = renderTitle()

    fireEvent.click(screen.getByTestId('issue-title'))
    fireEvent.change(screen.getByLabelText('Issue title'), {
      target: { value: 'discard me' },
    })
    fireEvent.keyDown(screen.getByLabelText('Issue title'), { key: 'Escape' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('issue-title').textContent).toBe(
      'Fix the flux capacitor',
    )
    // Cancelling hands focus back to the heading rather than dropping it on the body.
    expect(document.activeElement).toBe(headingRef.current)
  })

  it('refuses a blank title instead of writing one', async () => {
    const { onSave } = renderTitle()

    fireEvent.click(screen.getByTestId('issue-title'))
    const input = screen.getByLabelText('Issue title')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
    // The editor stays open on the blank draft rather than silently reverting.
    expect(screen.getByLabelText('Issue title')).toBeDefined()
  })

  it('spends no write when the title is unchanged', () => {
    const { onSave } = renderTitle()

    fireEvent.click(screen.getByTestId('issue-title'))
    fireEvent.keyDown(screen.getByLabelText('Issue title'), { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Issue title')).toBeNull()
  })

  it('commits on blur, like the rail inputs', async () => {
    const { onSave } = renderTitle()

    fireEvent.click(screen.getByTestId('issue-title'))
    const input = screen.getByLabelText('Issue title')
    fireEvent.change(input, { target: { value: 'Renamed by blur' } })
    fireEvent.blur(input)

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        'Renamed by blur',
        'Fix the flux capacitor',
      ),
    )
  })

  it('keeps the draft when the save is refused', async () => {
    const onSave = vi.fn().mockResolvedValue({ saved: false })
    renderTitle({ onSave })

    fireEvent.click(screen.getByTestId('issue-title'))
    const input = screen.getByLabelText('Issue title')
    fireEvent.change(input, { target: { value: 'Rejected rename' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(
      (screen.getByLabelText('Issue title') as HTMLInputElement).value,
    ).toBe('Rejected rename')
  })

  // pm-beads-6d5: a rename replaces the whole title, so one written over a name an agent
  // changed mid-edit erases it silently.
  describe('when the title changed underneath the editor', () => {
    it('keeps the draft and names the title it would have replaced', async () => {
      const onSave = vi
        .fn()
        .mockResolvedValue({ saved: false, storedText: 'Renamed by the agent' })
      renderTitle({ onSave })

      fireEvent.click(screen.getByTestId('issue-title'))
      const input = screen.getByLabelText('Issue title')
      fireEvent.change(input, { target: { value: 'My rename' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      const notice = await screen.findByTestId('title-conflict')
      expect(notice.textContent).toContain('Renamed by the agent')
      expect(
        (screen.getByLabelText('Issue title') as HTMLInputElement).value,
      ).toBe('My rename')
    })

    it('overwrites on an explicit press, against the title it showed', async () => {
      const onSave = vi
        .fn()
        .mockResolvedValueOnce({
          saved: false,
          storedText: 'Renamed by the agent',
        })
        .mockResolvedValueOnce({ saved: true })
      renderTitle({ onSave })

      fireEvent.click(screen.getByTestId('issue-title'))
      const input = screen.getByLabelText('Issue title')
      fireEvent.change(input, { target: { value: 'My rename' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await screen.findByTestId('title-conflict')

      fireEvent.click(screen.getByRole('button', { name: /Overwrite/ }))

      await waitFor(() =>
        expect(onSave).toHaveBeenLastCalledWith(
          'My rename',
          'Renamed by the agent',
        ),
      )
      await waitFor(() =>
        expect(screen.queryByLabelText('Issue title')).toBeNull(),
      )
    })

    it('does not save on blur while the conflict stands', async () => {
      const onSave = vi
        .fn()
        .mockResolvedValue({ saved: false, storedText: 'Renamed by the agent' })
      renderTitle({ onSave })

      fireEvent.click(screen.getByTestId('issue-title'))
      const input = screen.getByLabelText('Issue title')
      fireEvent.change(input, { target: { value: 'My rename' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await screen.findByTestId('title-conflict')

      // Blurring cannot resolve a stale baseline, so it must not spend a second write.
      fireEvent.blur(input)
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(screen.getByLabelText('Issue title')).toBeDefined()
    })
  })
})
