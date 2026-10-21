// ABOUTME: Tests project status-pipeline normalization across sidecar, bd config, and observed beads.
// ABOUTME: Covers ordering, icon validation, deduplication, and malformed-config fallbacks.

import { describe, expect, it } from 'vitest'
import {
  buildStatusPipeline,
  DEFAULT_LIST_STATUS_ORDER,
  DEFAULT_STATUS_PIPELINE,
  listStatusOrder,
  parseConfiguredStatuses,
} from '../status-model'

describe('buildStatusPipeline', () => {
  it('merges project order, configured statuses, observed statuses, and built-ins', () => {
    expect(
      buildStatusPipeline({
        block: {
          pipeline: ['open', 'review', 'closed'],
          icons: { review: 'eye' },
        },
        configured: ['review', 'qa'],
        observed: ['deploying', 'qa'],
      }),
    ).toEqual({
      authored: true,
      statuses: [
        'open',
        'review',
        'qa',
        'deploying',
        'deferred',
        'in_progress',
        'blocked',
        'closed',
      ],
      icons: { review: 'eye' },
    })
  })

  // A pipeline names the statuses a project knows it has. Anything else — a status bd was
  // configured with after the sidecar was written, or one a lane invented on a bead — has to
  // land somewhere, and after the authored order means after Done: a board whose last column
  // is "Deploying" and whose middle column is "Done" reads as broken (pm-beads-r8l.3).
  it('places statuses the pipeline does not name before the terminal status', () => {
    const pipeline = buildStatusPipeline({
      block: { pipeline: ['open', 'in_progress', 'closed'] },
      configured: ['qa'],
      observed: ['deploying'],
    })
    expect(pipeline.statuses).toEqual([
      'open',
      'in_progress',
      'qa',
      'deploying',
      'deferred',
      'blocked',
      'closed',
    ])
  })

  // Nothing guarantees a hand-written pipeline ends on `closed`, and the built-ins contribute
  // it regardless. With no terminal status to sit in front of, the extras simply follow.
  it('appends extras when the authored pipeline has no terminal status', () => {
    expect(
      buildStatusPipeline({
        block: { pipeline: ['triage', 'open'] },
        observed: ['shipping'],
      }).statuses,
    ).toEqual([
      'triage',
      'open',
      'shipping',
      'deferred',
      'in_progress',
      'blocked',
      'closed',
    ])
  })

  it('falls back safely when the project block is malformed', () => {
    expect(
      buildStatusPipeline({ block: { icons: { open: 'not-an-icon' } } }),
    ).toEqual(DEFAULT_STATUS_PIPELINE)
  })

  // `observed` is whatever order the beads came back from bd in, which is not a promise bd
  // makes. Letting it hoist a built-in status made the pipeline — and every grouped list and
  // board built from it — reorder itself between reads (pm-beads-7i1.1).
  it('never lets an observed built-in status reorder the built-in pipeline', () => {
    const arrival = buildStatusPipeline({
      observed: ['closed', 'in_progress', 'open'],
    })
    const reversed = buildStatusPipeline({
      observed: ['open', 'in_progress', 'closed'],
    })
    expect(arrival.statuses).toEqual(DEFAULT_STATUS_PIPELINE.statuses)
    expect(reversed.statuses).toEqual(DEFAULT_STATUS_PIPELINE.statuses)
  })

  it('places unknown observed statuses in a stable order, whatever order they arrive in', () => {
    const first = buildStatusPipeline({ observed: ['staging', 'qa', 'open'] })
    const second = buildStatusPipeline({ observed: ['open', 'qa', 'staging'] })
    expect(first.statuses).toEqual(second.statuses)
    expect(first.statuses).toEqual([
      'deferred',
      'open',
      'in_progress',
      'blocked',
      'qa',
      'staging',
      'closed',
    ])
  })

  it('marks a pipeline authored only when the project declared one', () => {
    expect(buildStatusPipeline({ observed: ['open'] }).authored).toBe(false)
    expect(
      buildStatusPipeline({ configured: ['qa'], observed: ['qa'] }).authored,
    ).toBe(false)
    expect(
      buildStatusPipeline({ block: { pipeline: ['open', 'closed'] } }).authored,
    ).toBe(true)
  })
})

describe('listStatusOrder', () => {
  // Board columns read left-to-right as a workflow; grouped lists lead with work in flight.
  it('keeps the list reading order when the project authored no pipeline', () => {
    expect(listStatusOrder(DEFAULT_STATUS_PIPELINE)).toEqual(
      DEFAULT_LIST_STATUS_ORDER,
    )
  })

  it('borrows the pipeline’s extra statuses without adopting its workflow order', () => {
    expect(
      listStatusOrder(buildStatusPipeline({ observed: ['qa', 'open'] })),
    ).toEqual(['in_progress', 'blocked', 'open', 'deferred', 'qa', 'closed'])
  })

  // Done is the bottom of a grouped list for the same reason it is the last board column.
  it('keeps a borrowed status above the closed group', () => {
    const order = listStatusOrder(
      buildStatusPipeline({ configured: ['qa', 'awaiting_deploy'] }),
    )
    expect(order.at(-1)).toBe('closed')
    expect(order.indexOf('qa')).toBeLessThan(order.indexOf('closed'))
  })

  it('defers to an authored pipeline, which governs every view', () => {
    const pipeline = buildStatusPipeline({
      block: { pipeline: ['open', 'qa', 'closed'] },
    })
    expect(listStatusOrder(pipeline)).toEqual(pipeline.statuses)
  })
})

describe('parseConfiguredStatuses', () => {
  it('accepts comma and whitespace separated bd config values', () => {
    expect(parseConfiguredStatuses('review, qa\nshipping review')).toEqual([
      'review',
      'qa',
      'shipping',
    ])
  })

  it('ignores non-string values', () => {
    expect(parseConfiguredStatuses(null)).toEqual([])
  })
})
