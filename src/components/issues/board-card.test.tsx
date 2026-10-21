// ABOUTME: Component tests for the presentational board card — anatomy (title, status, id,
// ABOUTME: metadata chips), display-property visibility, click handling, and saving state.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Issue } from '@/lib/beads/types'
import { BoardCard } from './board-card'

afterEach(cleanup)

const baseIssue: Issue = {
  id: 'pm-1',
  title: 'Ship the board view',
  status: 'in_progress',
  priority: 1,
  issue_type: 'task',
  labels: ['frontend'],
  parent: 'pm-epic',
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-01T00:00:00Z',
}

const allProperties = { priority: true, labels: true, project: true }

function renderCard(overrides: Partial<Parameters<typeof BoardCard>[0]> = {}) {
  const onClick = vi.fn()
  render(
    <BoardCard
      issue={baseIssue}
      epicNames={{ 'pm-epic': 'Big Epic' }}
      properties={allProperties}
      onClick={onClick}
      {...overrides}
    />,
  )
  return onClick
}

describe('BoardCard', () => {
  it('leads with the title, then status, id and metadata chips', () => {
    renderCard()
    expect(screen.getByText('pm-1')).toBeTruthy()
    expect(screen.getByLabelText('In Progress')).toBeTruthy()
    expect(screen.getByText('Ship the board view')).toBeTruthy()
    expect(screen.getByText('frontend')).toBeTruthy()
    expect(screen.getByText('Big Epic')).toBeTruthy()
    // The card names the bead first; the id is footer metadata under it.
    expect(screen.getByRole('button').textContent).toMatch(
      /Ship the board view.*pm-1/,
    )
    expect(screen.getByRole('button').getAttribute('title')).toBe(
      'Ship the board view · pm-1',
    )
  })

  it('hides metadata chips when display properties are off but keeps id and status', () => {
    renderCard({
      properties: { priority: false, labels: false, project: false },
    })
    expect(screen.getByText('pm-1')).toBeTruthy()
    expect(screen.getByLabelText('In Progress')).toBeTruthy()
    expect(screen.queryByText('frontend')).toBeNull()
    expect(screen.queryByText('Big Epic')).toBeNull()
  })

  it('shows the blocked indicator only when blocked is true', () => {
    renderCard()
    expect(screen.queryByLabelText('Has an unresolved blocker')).toBeNull()
    cleanup()
    renderCard({ blocked: true })
    expect(screen.getByLabelText('Has an unresolved blocker')).toBeTruthy()
  })

  it('fires onClick when the card is clicked', () => {
    const onClick = renderCard()
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disables the card while saving', () => {
    const onClick = renderCard({ saving: true })
    const card = screen.getByText('pm-1').closest('button')
    expect(card?.disabled).toBe(true)
    if (card) fireEvent.click(card)
    expect(onClick).not.toHaveBeenCalled()
  })
})
