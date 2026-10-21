// ABOUTME: Tests for shared issue presentation primitives — stable label color hashing,
// ABOUTME: label/epic pill rendering, bead-reference secondary ids, and short date formatting.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusPipelineProvider } from '@/components/status-pipeline-context'
import {
  BeadId,
  beadRefTitle,
  EpicChip,
  LABEL_PALETTE,
  LabelPill,
  labelColorClass,
  StatusIcon,
  shortDate,
  statusLabel,
  TypeIcon,
  typeLabel,
} from './issue-meta'

afterEach(cleanup)

describe('labelColorClass', () => {
  it('returns the same color for the same label every time', () => {
    expect(labelColorClass('design')).toBe(labelColorClass('design'))
    expect(labelColorClass('backend')).toBe(labelColorClass('backend'))
  })

  it('always returns a color from the palette', () => {
    for (const label of ['ui', 'perf', 'bug', 'infra', 'a', '', 'Z9!']) {
      expect(LABEL_PALETTE).toContain(labelColorClass(label))
    }
  })

  it('spreads distinct labels across more than one palette color', () => {
    const labels = ['ui', 'perf', 'infra', 'docs', 'auth', 'data', 'mobile']
    const colors = new Set(labels.map(labelColorClass))
    expect(colors.size).toBeGreaterThan(1)
  })
})

describe('LabelPill', () => {
  it('renders the label name with its hashed color dot', () => {
    const { container } = render(<LabelPill label="design" />)
    expect(screen.getByText('design')).toBeTruthy()
    const dot = container.querySelector(`.${labelColorClass('design')}`)
    expect(dot).toBeTruthy()
  })
})

describe('EpicChip', () => {
  it('renders the epic name', () => {
    render(<EpicChip name="Big Epic" />)
    expect(screen.getByText('Big Epic')).toBeTruthy()
  })
})

describe('beadRefTitle', () => {
  it('leads with the title and keeps the id after it', () => {
    expect(beadRefTitle('pm-beads-1', 'Cache read is slow')).toBe(
      'Cache read is slow · pm-beads-1',
    )
  })

  it('falls back to the bare id when the title is unknown or blank', () => {
    expect(beadRefTitle('pm-beads-1')).toBe('pm-beads-1')
    expect(beadRefTitle('pm-beads-1', '   ')).toBe('pm-beads-1')
  })
})

describe('BeadId', () => {
  it('renders the id as muted secondary text beside a title', () => {
    render(<BeadId id="pm-beads-1" />)
    const id = screen.getByText('pm-beads-1')
    expect(id.className).toContain('text-muted-foreground')
    expect(id.className).toContain('font-mono')
  })
})

describe('typeLabel', () => {
  it('capitalizes known issue types', () => {
    expect(typeLabel('feature')).toBe('Feature')
    expect(typeLabel('decision')).toBe('Decision')
  })

  it('passes through unknown custom types verbatim', () => {
    expect(typeLabel('spike')).toBe('spike')
  })
})

describe('TypeIcon', () => {
  it('renders an icon for every known type and a fallback for custom', () => {
    for (const type of [
      'task',
      'bug',
      'feature',
      'epic',
      'chore',
      'decision',
      'spike',
    ]) {
      const { container } = render(<TypeIcon type={type} />)
      expect(container.querySelector('svg')).toBeTruthy()
      cleanup()
    }
  })
})

describe('StatusIcon', () => {
  it('updates from the selected project provider and keeps an unknown fallback', () => {
    const { container, rerender } = render(
      <StatusPipelineProvider
        value={{
          statuses: ['review'],
          icons: { review: 'eye' },
          authored: true,
        }}
      >
        <StatusIcon status="review" />
      </StatusPipelineProvider>,
    )
    expect(container.querySelector('.lucide-eye')).toBeTruthy()

    rerender(
      <StatusPipelineProvider
        value={{
          statuses: ['review'],
          icons: { review: 'rocket' },
          authored: true,
        }}
      >
        <StatusIcon status="review" />
      </StatusPipelineProvider>,
    )
    expect(container.querySelector('.lucide-rocket')).toBeTruthy()

    rerender(<StatusIcon status="brand_new" />)
    expect(container.querySelector('.lucide-circle-dashed')).toBeTruthy()
  })
})

describe('statusLabel', () => {
  it('keeps the built-in names, including bd’s closed reading as Done', () => {
    expect(statusLabel('in_progress')).toBe('In Progress')
    expect(statusLabel('closed')).toBe('Done')
  })

  it('title-cases a project’s custom status rather than showing its bd key', () => {
    expect(statusLabel('awaiting_deploy')).toBe('Awaiting Deploy')
    expect(statusLabel('in-review')).toBe('In Review')
    expect(statusLabel('qa')).toBe('Qa')
  })

  it('returns an unnameable status unchanged', () => {
    expect(statusLabel('')).toBe('')
    expect(statusLabel('__')).toBe('__')
  })
})

describe('shortDate', () => {
  it('formats dates in the current year as month + day', () => {
    const year = new Date().getFullYear()
    expect(shortDate(`${year}-06-12T00:00:00Z`)).toMatch(/^Jun \d{1,2}$/)
  })

  it('includes the year for dates in other years', () => {
    expect(shortDate('2024-03-05T12:00:00Z')).toMatch(/^Mar \d{1,2}, 2024$/)
  })
})
