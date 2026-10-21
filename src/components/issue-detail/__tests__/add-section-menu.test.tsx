// ABOUTME: Tests for the "Add section" menu — which optional long-text fields it offers, that it
// ABOUTME: disappears once every field is spoken for, and that choosing one reports the field.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddSectionMenu } from '../add-section-menu'

afterEach(cleanup)

/** Radix opens the menu on pointerdown, not click, and jsdom fires neither from `click`. Enter on
 * the trigger is the keyboard path and opens the same menu. */
function openMenu() {
  fireEvent.keyDown(screen.getByTestId('add-section'), { key: 'Enter' })
}

describe('AddSectionMenu', () => {
  it('renders nothing when every optional section is already present', () => {
    const { container } = render(
      <AddSectionMenu available={[]} onAdd={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('offers only the fields it was given, under their display names', async () => {
    render(
      <AddSectionMenu
        available={['design', 'acceptance_criteria']}
        onAdd={() => {}}
      />,
    )

    openMenu()

    expect(
      await screen.findByRole('menuitem', { name: 'Design' }),
    ).toBeDefined()
    expect(
      screen.getByRole('menuitem', { name: 'Acceptance criteria' }),
    ).toBeDefined()
    // Notes already had content, so it is not on offer.
    expect(screen.queryByRole('menuitem', { name: 'Notes' })).toBeNull()
  })

  it('reports the chosen field', async () => {
    const onAdd = vi.fn()
    render(<AddSectionMenu available={['notes']} onAdd={onAdd} />)

    openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Notes' }))

    expect(onAdd).toHaveBeenCalledWith('notes')
  })
})
