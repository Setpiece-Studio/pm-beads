// ABOUTME: Tests for the rail's Pull request row — the linked state (title, badge, external
// ABOUTME: link, unlink) and the empty state's inline "Link PR…" input with its validation.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrStatus } from '@/lib/beads/pr-state'
import { PullRequestRow } from '../pull-request-row'

afterEach(cleanup)

const URL = 'https://github.com/example-owner/pm-beads/pull/9'

function renderRow(
  overrides: Partial<React.ComponentProps<typeof PullRequestRow>> = {},
) {
  const props = {
    saving: false,
    onLink: vi.fn(),
    onUnlink: vi.fn(),
    getPrState: vi.fn(
      async (url: string): Promise<PrStatus> => ({
        url,
        state: 'unknown' as const,
      }),
    ),
    ...overrides,
  }
  render(<PullRequestRow {...props} />)
  return props
}

describe('PullRequestRow — linked', () => {
  it('shows the number, title, and state badge from gh', async () => {
    renderRow({
      prUrl: URL,
      getPrState: vi.fn(async () => ({
        url: URL,
        number: 9,
        title: 'Link PRs to beads',
        state: 'merged' as const,
      })),
    })

    expect(await screen.findByText('#9')).toBeTruthy()
    expect(screen.getByText('Link PRs to beads')).toBeTruthy()
    expect(screen.getByText('Merged')).toBeTruthy()
  })

  it('renders each state with its own badge text', async () => {
    for (const [state, label] of [
      ['open', 'Open'],
      ['draft', 'Draft'],
      ['closed', 'Closed'],
      ['unknown', 'Unknown'],
    ] as const) {
      renderRow({
        prUrl: URL,
        getPrState: vi.fn(async () => ({ url: URL, state })),
      })
      expect(await screen.findByText(label)).toBeTruthy()
      cleanup()
    }
  })

  it('falls back to the url path when gh reports no title', async () => {
    renderRow({
      prUrl: URL,
      getPrState: vi.fn(async () => ({ url: URL, state: 'unknown' as const })),
    })
    expect(await screen.findByText('example-owner/pm-beads#9')).toBeTruthy()
  })

  it('links out to the PR in a new tab', async () => {
    renderRow({ prUrl: URL })
    const link = await screen.findByRole('link', { name: /pull request/i })
    expect(link.getAttribute('href')).toBe(URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('unlinks via the × control', async () => {
    const props = renderRow({ prUrl: URL })
    fireEvent.click(
      await screen.findByRole('button', { name: /unlink pull request/i }),
    )
    expect(props.onUnlink).toHaveBeenCalledOnce()
  })

  it('disables the unlink control while a mutation is in flight', async () => {
    renderRow({ prUrl: URL, saving: true })
    const button = await screen.findByRole('button', {
      name: /unlink pull request/i,
    })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('falls back to the Unknown badge when the state call itself rejects', async () => {
    renderRow({
      prUrl: URL,
      getPrState: vi.fn().mockRejectedValue(new Error('network')),
    })
    expect(await screen.findByText('Unknown')).toBeTruthy()
    expect(screen.getByText('example-owner/pm-beads#9')).toBeTruthy()
  })

  it('reads state once per url, not on every render', async () => {
    const getPrState = vi.fn(async () => ({
      url: URL,
      state: 'open' as const,
    }))
    renderRow({ prUrl: URL, getPrState })
    await screen.findByText('Open')
    expect(getPrState).toHaveBeenCalledTimes(1)
    expect(getPrState).toHaveBeenCalledWith(URL)
  })
})

describe('PullRequestRow — empty', () => {
  it('offers a Link PR affordance that reveals an input', () => {
    renderRow()
    expect(screen.queryByLabelText(/pull request url or number/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /link pr/i }))
    expect(screen.getByLabelText(/pull request url or number/i)).toBeTruthy()
  })

  it('saves a pasted url on Enter', () => {
    const props = renderRow()
    fireEvent.click(screen.getByRole('button', { name: /link pr/i }))
    const input = screen.getByLabelText(/pull request url or number/i)
    fireEvent.change(input, { target: { value: URL } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onLink).toHaveBeenCalledWith(URL)
  })

  it('saves a bare number and a #N reference', () => {
    for (const typed of ['42', '#42']) {
      const props = renderRow()
      fireEvent.click(screen.getByRole('button', { name: /link pr/i }))
      const input = screen.getByLabelText(/pull request url or number/i)
      fireEvent.change(input, { target: { value: typed } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(props.onLink).toHaveBeenCalledWith(typed)
      cleanup()
    }
  })

  it('shows an inline error for invalid input and does not save', () => {
    const props = renderRow()
    fireEvent.click(screen.getByRole('button', { name: /link pr/i }))
    const input = screen.getByLabelText(/pull request url or number/i)
    fireEvent.change(input, { target: { value: 'https://example.com/x' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(props.onLink).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/url or number/i)
  })

  it('clears the inline error once the input becomes valid', () => {
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: /link pr/i }))
    const input = screen.getByLabelText(/pull request url or number/i)
    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert')).toBeTruthy()

    fireEvent.change(input, { target: { value: '42' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cancels on Escape without saving', () => {
    const props = renderRow()
    fireEvent.click(screen.getByRole('button', { name: /link pr/i }))
    const input = screen.getByLabelText(/pull request url or number/i)
    fireEvent.change(input, { target: { value: URL } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(props.onLink).not.toHaveBeenCalled()
    expect(screen.queryByLabelText(/pull request url or number/i)).toBeNull()
    expect(screen.getByRole('button', { name: /link pr/i })).toBeTruthy()
  })

  it('never reads PR state when nothing is linked', async () => {
    const props = renderRow()
    await waitFor(() => {
      expect(props.getPrState).not.toHaveBeenCalled()
    })
  })
})
