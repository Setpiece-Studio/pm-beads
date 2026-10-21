// ABOUTME: Tests for the activity feed's row presentation — the typed glyph each history event
// ABOUTME: gets, and the actor-led sentence that names who did it when bd can say.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivityEvent } from '@/lib/beads/activity'
import { EventGlyph, eventSentence } from '../activity-items'

function event(patch: Partial<ActivityEvent> & Pick<ActivityEvent, 'kind'>) {
  return {
    id: 'h1:x',
    at: '2026-06-02T00:00:00Z',
    ...patch,
  } as ActivityEvent
}

describe('eventSentence — actor-led when bd can attribute the change', () => {
  it('leads with the actor on creation', () => {
    expect(eventSentence(event({ kind: 'created', actor: 'Ben' }))).toBe(
      'Ben created the issue',
    )
  })

  it('says "moved" forward along the workflow and "moved back" in reverse', () => {
    expect(
      eventSentence(
        event({
          kind: 'status',
          actor: 'Ben',
          from: 'open',
          to: 'in_progress',
        }),
      ),
    ).toBe('Ben moved from Open to In Progress')
    expect(
      eventSentence(
        event({
          kind: 'status',
          actor: 'Ben',
          from: 'closed',
          to: 'in_progress',
        }),
      ),
    ).toBe('Ben moved back from Done to In Progress')
  })

  it('names the actor on a priority, type, rename, and edit', () => {
    expect(
      eventSentence(event({ kind: 'priority', actor: 'Ben', from: 1, to: 0 })),
    ).toBe('Ben changed priority from High to Urgent')
    expect(
      eventSentence(
        event({ kind: 'type', actor: 'Ben', from: 'task', to: 'bug' }),
      ),
    ).toBe('Ben changed type from Task to Bug')
    expect(
      eventSentence(
        event({ kind: 'renamed', actor: 'Ben', from: 'Old', to: 'New name' }),
      ),
    ).toBe('Ben renamed this to “New name”')
    expect(
      eventSentence(
        event({ kind: 'edited', actor: 'Ben', field: 'acceptance_criteria' }),
      ),
    ).toBe('Ben edited the acceptance criteria')
  })

  it('names the actor on a close, a reopen, and an assignment', () => {
    expect(
      eventSentence(event({ kind: 'closed', actor: 'Ben', reason: 'done' })),
    ).toBe('Ben closed this as done')
    expect(
      eventSentence(event({ kind: 'reopened', actor: 'Ben', to: 'open' })),
    ).toBe('Ben reopened this as Open')
    expect(
      eventSentence(
        event({ kind: 'assigned', actor: 'Ben', to: 'Kim', self: false }),
      ),
    ).toBe('Ben assigned this to Kim')
    expect(
      eventSentence(event({ kind: 'unassigned', actor: 'Ben', from: 'Kim' })),
    ).toBe('Ben unassigned Kim')
  })
})

describe('eventSentence — the passive fallback for what bd cannot attribute', () => {
  it('keeps the field-named phrasing so no change is credited to the wrong person', () => {
    expect(eventSentence(event({ kind: 'created' }))).toBe('Issue created')
    expect(
      eventSentence(event({ kind: 'status', from: 'open', to: 'in_progress' })),
    ).toBe('Status changed from Open to In Progress')
    expect(eventSentence(event({ kind: 'priority', from: 1, to: 0 }))).toBe(
      'Priority changed from High to Urgent',
    )
    expect(
      eventSentence(event({ kind: 'type', from: 'task', to: 'bug' })),
    ).toBe('Type changed from Task to Bug')
    expect(
      eventSentence(event({ kind: 'renamed', from: 'Old', to: 'New name' })),
    ).toBe('Renamed to “New name”')
    expect(eventSentence(event({ kind: 'edited', field: 'description' }))).toBe(
      'Description edited',
    )
    expect(eventSentence(event({ kind: 'closed', reason: 'done' }))).toBe(
      'Closed as done',
    )
    expect(eventSentence(event({ kind: 'closed' }))).toBe('Issue closed')
    expect(eventSentence(event({ kind: 'reopened', to: 'open' }))).toBe(
      'Reopened as Open',
    )
    expect(
      eventSentence(event({ kind: 'assigned', to: 'Kim', self: false })),
    ).toBe('Assigned to Kim')
    expect(
      eventSentence(event({ kind: 'assigned', to: 'Kim', self: true })),
    ).toBe('Kim self-assigned')
    expect(eventSentence(event({ kind: 'unassigned', from: 'Kim' }))).toBe(
      'Unassigned from Kim',
    )
    expect(eventSentence(event({ kind: 'unassigned', from: '' }))).toBe(
      'Unassigned',
    )
  })
})

describe('EventGlyph', () => {
  afterEach(cleanup)

  /** Every glyph occupies the same 20px optical column, so the rail behind them stays straight. */
  function glyph(item: ActivityEvent) {
    const { container } = render(<EventGlyph event={item} />)
    const slot = container.firstElementChild as HTMLElement
    expect(slot.className).toContain('size-5')
    return slot
  }

  it('shows a person for the events a person is named on', () => {
    expect(
      glyph(event({ kind: 'created', actor: 'Ben Harper' })).textContent,
    ).toBe('BH')
    expect(
      glyph(
        event({
          kind: 'assigned',
          actor: 'Ben Harper',
          to: 'Ben Harper',
          self: true,
        }),
      ).textContent,
    ).toBe('BH')
  })

  it('colors a status change by the status it landed on', () => {
    expect(
      glyph(
        event({ kind: 'status', from: 'open', to: 'in_progress' }),
      ).querySelector('.text-yellow-500'),
    ).not.toBeNull()
    expect(
      glyph(
        event({ kind: 'status', from: 'open', to: 'blocked' }),
      ).querySelector('.text-red-500'),
    ).not.toBeNull()
    expect(
      glyph(event({ kind: 'closed', reason: 'done' })).querySelector(
        '.text-indigo-500',
      ),
    ).not.toBeNull()
    expect(
      glyph(event({ kind: 'reopened', to: 'in_progress' })).querySelector(
        '.text-yellow-500',
      ),
    ).not.toBeNull()
  })

  it('shows the priority and type glyphs the rest of the app uses', () => {
    // The urgent glyph is the orange square, not an svg — its title is what identifies it.
    expect(
      glyph(event({ kind: 'priority', from: 1, to: 0 })).querySelector(
        '[title="Urgent"]',
      ),
    ).not.toBeNull()
    expect(
      glyph(event({ kind: 'type', from: 'task', to: 'bug' })).querySelector(
        '.text-red-500',
      ),
    ).not.toBeNull()
    expect(
      glyph(event({ kind: 'type', from: 'task', to: 'feature' })).querySelector(
        '.text-purple-500',
      ),
    ).not.toBeNull()
  })

  it('leaves a rename or an edit uncolored — nothing semantic changed', () => {
    for (const item of [
      event({ kind: 'renamed', from: 'a', to: 'b' }),
      event({ kind: 'edited', field: 'description' }),
    ]) {
      const slot = glyph(item)
      expect(slot.querySelector('.text-muted-foreground')).not.toBeNull()
      expect(slot.innerHTML).not.toMatch(
        /text-(red|yellow|indigo|purple|blue|orange)-500/,
      )
    }
  })
})
