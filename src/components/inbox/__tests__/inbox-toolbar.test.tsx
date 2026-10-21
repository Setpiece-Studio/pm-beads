// ABOUTME: The inbox offers only the open-ask count and chronological sort.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { InboxToolbar } from '../inbox-toolbar'

afterEach(cleanup)
it('counts open-ask beads without tabs or read actions', () => {
  render(<InboxToolbar count={3} sort="newest" onChange={() => {}} />)
  expect(screen.getByText('3 with open asks')).toBeTruthy()
  expect(
    screen.queryByRole('button', { name: /Agents|Mine|read|Filter/i }),
  ).toBeNull()
})
it('changes the chronological sort', () => {
  const onChange = vi.fn()
  render(<InboxToolbar count={0} sort="newest" onChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
  fireEvent.click(screen.getByRole('button', { name: 'Oldest first' }))
  expect(onChange).toHaveBeenCalledWith({ sort: 'oldest' })
})
