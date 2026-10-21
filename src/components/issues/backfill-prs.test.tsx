// ABOUTME: Component tests for the PR-history backfill review panel — the scan it runs on open,
// ABOUTME: which rows come pre-checked, applying a selection, skipping a row, and its failures.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BackfillProposal } from '@/lib/beads/pr-backfill'
import type {
  BackfillApplyResult,
  BackfillScanResult,
} from '@/lib/beads/pr-backfill-run'
import { BackfillPrs } from './backfill-prs'

afterEach(cleanup)

// Radix dialog positioning (floating-ui) needs ResizeObserver, absent in jsdom.
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

function proposal(overrides: Partial<BackfillProposal> = {}): BackfillProposal {
  return {
    id: 'pm-beads-a1',
    title: 'Ship the rail row',
    status: 'open',
    issue_type: 'task',
    prUrl: 'https://github.com/o/r/pull/42',
    prNumber: 42,
    prTitle: 'Add the rail row',
    mergedAt: '2026-08-20T12:00:00Z',
    confidence: 'high',
    actions: ['set-pr-url', 'close'],
    ...overrides,
  }
}

function scanResult(
  overrides: Partial<BackfillScanResult> = {},
): BackfillScanResult {
  return {
    proposals: [],
    prefix: 'pm-beads-',
    repos: ['o/r'],
    warnings: [],
    daysBack: 180,
    since: '2026-03-01T00:00:00.000Z',
    ranAt: '2026-08-27T12:00:00.000Z',
    scannedPrs: 12,
    ...overrides,
  }
}

function applyResult(
  overrides: Partial<BackfillApplyResult> = {},
): BackfillApplyResult {
  return { applied: [], warnings: [], ...overrides }
}

interface RenderOptions {
  scan: (daysBack: number) => Promise<BackfillScanResult>
  apply?: (proposals: BackfillProposal[]) => Promise<BackfillApplyResult>
  skip?: (ids: string[]) => Promise<void>
  onSelectIssue?: (id: string) => void
  onApplied?: () => void
}

function renderOpen(options: RenderOptions) {
  const props = {
    apply: async () => applyResult(),
    skip: async () => {},
    ...options,
  }
  render(<BackfillPrs open onOpenChange={() => {}} {...props} />)
}

function row(id: string): HTMLElement {
  return screen
    .getByTestId('backfill-panel')
    .querySelector<HTMLElement>(`[data-bead-id="${id}"]`) as HTMLElement
}

function checkboxIn(element: HTMLElement): HTMLInputElement {
  return within(element).getByRole('checkbox') as HTMLInputElement
}

describe('BackfillPrs', () => {
  it('scans as soon as the panel opens — it writes nothing, so there is nothing to confirm', async () => {
    const scan = vi.fn(async () => scanResult())
    renderOpen({ scan })

    await waitFor(() => expect(scan).toHaveBeenCalledWith(180))
    expect(await screen.findByTestId('backfill-panel')).toBeTruthy()
  })

  it('pre-checks the high-confidence rows and leaves the rest for a person to decide', async () => {
    renderOpen({
      scan: async () =>
        scanResult({
          proposals: [
            proposal({ id: 'pm-beads-a1', confidence: 'high' }),
            proposal({ id: 'pm-beads-b2', confidence: 'medium' }),
            proposal({ id: 'pm-beads-c3', confidence: 'low' }),
          ],
        }),
    })

    await screen.findByTestId('backfill-panel')
    expect(checkboxIn(row('pm-beads-a1')).checked).toBe(true)
    expect(checkboxIn(row('pm-beads-b2')).checked).toBe(false)
    expect(checkboxIn(row('pm-beads-c3')).checked).toBe(false)
  })

  it('shows the confidence tier and what applying the row would do', async () => {
    renderOpen({
      scan: async () =>
        scanResult({
          proposals: [
            proposal({ id: 'pm-beads-a1' }),
            proposal({
              id: 'pm-beads-e1',
              issue_type: 'epic',
              confidence: 'medium',
              actions: ['set-pr-url', 'comment-only'],
            }),
          ],
        }),
    })

    await screen.findByTestId('backfill-panel')
    expect(row('pm-beads-a1').textContent).toContain('high')
    expect(row('pm-beads-a1').textContent).toContain('Link + close')
    expect(row('pm-beads-e1').textContent).toContain('medium')
    expect(row('pm-beads-e1').textContent).toContain('Link + comment')
  })

  it('applies exactly the checked rows and reports what it did', async () => {
    const apply = vi.fn(async (proposals: BackfillProposal[]) =>
      applyResult({
        applied: proposals.map((p) => ({
          id: p.id,
          title: p.title,
          prUrl: p.prUrl,
          prNumber: p.prNumber,
          kind: 'close' as const,
        })),
      }),
    )
    const onApplied = vi.fn()
    renderOpen({
      scan: async () =>
        scanResult({
          proposals: [
            proposal({ id: 'pm-beads-a1', confidence: 'high' }),
            proposal({ id: 'pm-beads-b2', confidence: 'medium' }),
          ],
        }),
      apply,
      onApplied,
    })

    await screen.findByTestId('backfill-panel')
    fireEvent.click(screen.getByRole('button', { name: /Apply selected/ }))

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    expect(apply.mock.calls[0][0].map((p) => p.id)).toEqual(['pm-beads-a1'])

    const results = await screen.findByTestId('backfill-results')
    expect(results.textContent).toContain('pm-beads-a1')
    expect(onApplied).toHaveBeenCalled()

    // The applied row is gone; the one left unchecked is still there to decide on.
    expect(row('pm-beads-a1')).toBeNull()
    expect(row('pm-beads-b2')).toBeTruthy()
  })

  it('will not apply an empty selection', async () => {
    const apply = vi.fn(async () => applyResult())
    renderOpen({
      scan: async () =>
        scanResult({
          proposals: [proposal({ id: 'pm-beads-b2', confidence: 'low' })],
        }),
      apply,
    })

    await screen.findByTestId('backfill-panel')
    const button = screen.getByRole('button', {
      name: /Apply selected/,
    }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(apply).not.toHaveBeenCalled()
  })

  it('skips a row through the server so it does not come back next scan', async () => {
    const skip = vi.fn(async () => {})
    renderOpen({
      scan: async () =>
        scanResult({ proposals: [proposal({ id: 'pm-beads-a1' })] }),
      skip,
    })

    await screen.findByTestId('backfill-panel')
    fireEvent.click(
      within(row('pm-beads-a1')).getByRole('button', { name: 'Skip' }),
    )

    await waitFor(() => expect(skip).toHaveBeenCalledWith(['pm-beads-a1']))
    await waitFor(() => expect(row('pm-beads-a1')).toBeNull())
  })

  it('rescans with the window the user typed', async () => {
    const scan = vi.fn(async () => scanResult())
    renderOpen({ scan })

    await screen.findByTestId('backfill-panel')
    fireEvent.change(screen.getByLabelText('Days of history'), {
      target: { value: '30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))

    await waitFor(() => expect(scan).toHaveBeenLastCalledWith(30))
  })

  it('says so when the history holds nothing to propose', async () => {
    renderOpen({ scan: async () => scanResult({ scannedPrs: 12 }) })
    expect(await screen.findByText(/No beads to backfill/)).toBeTruthy()
  })

  it('shows the scan warnings without hiding the proposals', async () => {
    renderOpen({
      scan: async () =>
        scanResult({
          proposals: [proposal({ id: 'pm-beads-a1' })],
          warnings: ['o/r: gh pr list failed — not found'],
        }),
    })

    await screen.findByTestId('backfill-panel')
    expect(screen.getByText(/gh pr list failed/)).toBeTruthy()
    expect(row('pm-beads-a1')).toBeTruthy()
  })

  it('reports a scan that threw instead of rendering an empty list', async () => {
    renderOpen({
      scan: async () => {
        throw new Error('bd exploded')
      },
    })
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'bd exploded',
    )
  })

  it('opens a bead from its row when the caller can navigate', async () => {
    const onSelectIssue = vi.fn()
    renderOpen({
      scan: async () =>
        scanResult({ proposals: [proposal({ id: 'pm-beads-a1' })] }),
      onSelectIssue,
    })

    await screen.findByTestId('backfill-panel')
    fireEvent.click(
      within(row('pm-beads-a1')).getByRole('button', { name: 'pm-beads-a1' }),
    )
    expect(onSelectIssue).toHaveBeenCalledWith('pm-beads-a1')
  })
})
