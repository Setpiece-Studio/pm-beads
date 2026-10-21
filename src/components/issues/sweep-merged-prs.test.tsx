// ABOUTME: Component tests for the toolbar's Sweep merged PRs control — the preview/sweep
// ABOUTME: buttons, the summary the panel renders, and its empty, warning, and failure states.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SweepResult } from '@/lib/beads/pr-sweep-run'
import { SweepMergedPrs } from './sweep-merged-prs'

afterEach(cleanup)

// Radix popover positioning (floating-ui) needs ResizeObserver, absent in jsdom.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

function result(overrides: Partial<SweepResult> = {}): SweepResult {
  return {
    closed: [],
    commented: [],
    skipped: [],
    warnings: [],
    since: '2026-07-28T12:00:00.000Z',
    ranAt: '2026-08-27T12:00:00.000Z',
    dryRun: false,
    ...overrides,
  }
}

const CLOSED_BEAD = {
  id: 'pm-beads-a1',
  title: 'Ship the rail row',
  prUrl: 'https://github.com/o/r/pull/42',
  prNumber: 42,
}

interface RenderOptions {
  sweep: (dryRun: boolean) => Promise<SweepResult>
  onSelectIssue?: (id: string) => void
  onSwept?: () => void
}

/** Render the control and open its panel — nothing runs until a button in it is clicked. */
function renderOpen(options: RenderOptions) {
  render(<SweepMergedPrs {...options} />)
  fireEvent.click(screen.getByRole('button', { name: 'Sweep merged PRs' }))
}

function summaryText(): Promise<string> {
  return screen.findByTestId('sweep-summary').then((el) => el.textContent ?? '')
}

describe('SweepMergedPrs', () => {
  it('does not run anything just by opening the panel', async () => {
    const sweep = vi.fn(async () => result())
    renderOpen({ sweep })

    expect(
      await screen.findByRole('button', { name: 'Sweep now' }),
    ).toBeTruthy()
    expect(sweep).not.toHaveBeenCalled()
  })

  it('previews as a dry run and sweeps for real', async () => {
    const sweep = vi.fn(async () => result())
    renderOpen({ sweep })

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await summaryText()
    expect(sweep).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: 'Sweep now' }))
    await waitFor(() => expect(sweep).toHaveBeenLastCalledWith(false))
  })

  it('lists what it closed and what it only commented on', async () => {
    renderOpen({
      sweep: async () =>
        result({
          closed: [CLOSED_BEAD],
          commented: [
            {
              id: 'pm-beads-e1',
              title: 'PR-linked beads',
              prUrl: 'https://github.com/o/r/pull/43',
              prNumber: 43,
            },
          ],
        }),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Sweep now' }))

    const text = await summaryText()
    expect(text).toContain('Closed 1')
    expect(text).toContain('pm-beads-a1')
    expect(text).toContain('Ship the rail row')
    expect(text).toContain('#42')
    expect(text).toContain('Commented only 1')
    expect(text).toContain('pm-beads-e1')
  })

  it('says so when nothing had merged', async () => {
    renderOpen({ sweep: async () => result() })
    fireEvent.click(await screen.findByRole('button', { name: 'Sweep now' }))

    expect(await summaryText()).toContain('Nothing to close')
  })

  it('marks a preview as a dry run so nobody reads it as done work', async () => {
    renderOpen({
      sweep: async () => result({ dryRun: true, closed: [CLOSED_BEAD] }),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    expect(await summaryText()).toContain('Dry run')
  })

  it('shows the repos gh could not read without hiding what did happen', async () => {
    renderOpen({
      sweep: async () =>
        result({
          closed: [CLOSED_BEAD],
          warnings: ['other/repo: gh pr list failed — gh: not authenticated'],
        }),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Sweep now' }))

    const text = await summaryText()
    expect(text).toContain('gh: not authenticated')
    expect(text).toContain('Closed 1')
  })

  it('reports a failed sweep instead of pretending it found nothing', async () => {
    renderOpen({
      sweep: async () => {
        throw new Error('bd is wedged')
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Sweep now' }))

    expect((await screen.findByRole('alert')).textContent).toContain(
      'bd is wedged',
    )
  })

  it('hands a swept bead id to the caller when its row is clicked', async () => {
    const onSelectIssue = vi.fn()
    renderOpen({
      sweep: async () => result({ closed: [CLOSED_BEAD] }),
      onSelectIssue,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Sweep now' }))
    fireEvent.click(await screen.findByRole('button', { name: /pm-beads-a1/ }))

    expect(onSelectIssue).toHaveBeenCalledWith('pm-beads-a1')
  })

  it('tells the caller a real sweep finished, but not a preview', async () => {
    const onSwept = vi.fn()
    // The component keys on the RESULT's dryRun flag (the server's own account of what it
    // did), not on the argument, so the stub has to echo it back.
    renderOpen({ sweep: async (dryRun) => result({ dryRun }), onSwept })

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await summaryText()
    expect(onSwept).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Sweep now' }))
    await waitFor(() => expect(onSwept).toHaveBeenCalledTimes(1))
  })
})
