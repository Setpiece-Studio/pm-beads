// ABOUTME: Interaction tests for metadata-backed Actions rows.
// ABOUTME: Covers collapse, open/closed order, action callbacks, answers, and malformed warnings.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ask } from '@/lib/beads/asks'
import { MilestonesSection, orderAsks } from '../milestones-section'

const base = {
  by: 'agent',
  at: '2026-09-10T20:00:00.000Z',
}

const asks: Ask[] = [
  {
    key: 'open-action',
    kind: 'action',
    q: 'Open action',
    note: 'Still needs work.',
    steps: ['First step', 'Second step'],
    ...base,
  },
  {
    key: 'decision',
    kind: 'decision',
    q: 'Choose a path',
    note: 'Pick the right approach.',
    ...base,
  },
  {
    key: 'check',
    kind: 'check',
    q: 'Check the result',
    note: 'Record what you verified.',
    ...base,
  },
  {
    key: 'review',
    kind: 'review',
    q: 'Review the approach',
    note: 'Leave review feedback.',
    ...base,
  },
  {
    key: 'closed-action',
    kind: 'action',
    q: 'Closed action',
    note: 'Already handled.',
    steps: ['Finished step'],
    answer: 'done',
    done: true,
    answered_by: 'ben',
    answered_at: '2026-09-10T21:00:00.000Z',
    ...base,
  },
]

afterEach(cleanup)

describe('MilestonesSection', () => {
  it('sorts answered asks after open asks without disturbing stable order', () => {
    expect(orderAsks(asks).map((ask) => ask.key)).toEqual([
      'open-action',
      'decision',
      'check',
      'review',
      'closed-action',
    ])
  })

  it('renders icons, descriptions, collapsible steps, and completed styling', () => {
    render(<MilestonesSection asks={asks} onAnswer={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Actions' })).toBeDefined()
    expect(screen.getAllByLabelText('Action')).toHaveLength(2)
    expect(screen.getByLabelText('Decision')).toBeDefined()
    expect(screen.getByLabelText('Check')).toBeDefined()
    expect(screen.getByLabelText('Review')).toBeDefined()
    expect(screen.getByText('Still needs work.')).toBeDefined()
    expect(screen.getByText('First step')).toBeDefined()

    const closedRow = screen.getByText('Closed action').closest('article')
    expect(closedRow?.dataset.completed).toBe('true')
    expect(screen.queryByText('Finished step')).toBeNull()

    fireEvent.click(screen.getByText('Closed action'))
    expect(screen.getByText('Finished step')).toBeDefined()
  })

  it('requests persisted action completion and reopening', () => {
    const onAnswer = vi.fn()
    render(<MilestonesSection asks={asks} onAnswer={onAnswer} />)

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Complete Open action' }),
    )
    expect(onAnswer).toHaveBeenCalledWith('open-action', 'done')

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Reopen Closed action' }),
    )
    expect(onAnswer).toHaveBeenCalledWith('closed-action', null)
  })

  it('submits a free-text decision answer', () => {
    const onAnswer = vi.fn()
    render(<MilestonesSection asks={asks} onAnswer={onAnswer} />)

    const input = screen.getByLabelText('Answer Choose a path')
    fireEvent.change(input, {
      target: { value: 'Use one JSON string' },
    })
    const form = input.closest('form')
    if (!form) throw new Error('Expected a decision answer form')
    fireEvent.submit(form)

    expect(onAnswer).toHaveBeenCalledWith('decision', 'Use one JSON string')
  })

  it.each([
    ['check', 'Check the result', 'Verified in production'],
    ['review', 'Review the approach', 'Looks good to me'],
  ])('submits a free-text %s answer', (key, question, answer) => {
    const onAnswer = vi.fn()
    render(<MilestonesSection asks={asks} onAnswer={onAnswer} />)

    const input = screen.getByLabelText(`Answer ${question}`)
    fireEvent.change(input, {
      target: { value: answer },
    })
    const form = input.closest('form')
    if (!form) throw new Error(`Expected a form for ${question}`)
    fireEvent.submit(form)

    expect(onAnswer).toHaveBeenCalledWith(key, answer)
  })

  it('reports malformed metadata without hiding valid asks', () => {
    render(
      <MilestonesSection
        asks={asks.slice(0, 1)}
        invalidKeys={['ask.broken']}
        onAnswer={vi.fn()}
      />,
    )
    expect(screen.getByText('Open action')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('1 malformed ask')
  })
})
