// ABOUTME: Unit tests for strict ask.* JSON parsing, open-state derivation, and answer replacement.
// ABOUTME: Malformed entries fail closed without preventing valid asks from rendering.

import { describe, expect, it } from 'vitest'
import {
  type AskValue,
  answerAskValue,
  askMetadataKey,
  hasOpenAsk,
  isAskOpen,
  openAskSummary,
  parseAsks,
  serializeAsk,
} from '../asks'

const decision: AskValue = {
  kind: 'decision',
  q: 'Choose storage',
  by: 'agent',
  at: '2026-09-10T20:00:00.000Z',
  note: 'Pick one representation.',
}

describe('ask metadata', () => {
  it('reads object asks and JSON-string asks identically', () => {
    expect(parseAsks({ 'ask.reauth': decision })).toEqual(
      parseAsks({ 'ask.reauth': serializeAsk(decision) }),
    )
    expect(hasOpenAsk({ 'ask.reauth': decision })).toBe(true)
    const answered = answerAskValue(
      decision,
      'yes',
      'ben',
      '2026-09-18T20:00:00Z',
    )
    expect(hasOpenAsk({ 'ask.reauth': answered })).toBe(false)
  })

  it('keeps malformed structured asks visible as invalid and open', () => {
    const metadata = {
      'ask.object': { ...decision, surprise: true },
      'ask.array': [decision],
      'ask.null': null,
    }
    expect(parseAsks(metadata)).toEqual({
      asks: [],
      invalidKeys: Object.keys(metadata),
    })
    expect(hasOpenAsk(metadata)).toBe(true)
  })

  it('round-trips one JSON string per ask', () => {
    const parsed = parseAsks({
      [askMetadataKey('storage')]: serializeAsk(decision),
      unrelated: true,
    })
    expect(parsed.invalidKeys).toEqual([])
    expect(parsed.asks).toEqual([{ key: 'storage', ...decision }])
    expect(isAskOpen(parsed.asks[0] as AskValue)).toBe(true)
    expect(() => askMetadataKey('not-valid')).toThrow()
  })

  it('skips malformed, non-string, and unknown-field ask values safely', () => {
    const parsed = parseAsks({
      'ask.valid': serializeAsk(decision),
      'ask.bad-json': '{',
      'ask.number': 42,
      'ask.extra': JSON.stringify({ ...decision, surprise: true }),
    })
    expect(parsed.asks.map((ask) => ask.key)).toEqual(['valid'])
    expect(parsed.invalidKeys).toEqual([
      'ask.bad-json',
      'ask.number',
      'ask.extra',
    ])
  })

  it('answers and reopens a decision as whole valid objects', () => {
    const answered = answerAskValue(
      decision,
      'One JSON string',
      'ben',
      '2026-09-10T21:00:00.000Z',
    )
    expect(answered).toMatchObject({
      answer: 'One JSON string',
      answered_by: 'ben',
      answered_at: '2026-09-10T21:00:00.000Z',
    })
    expect(isAskOpen(answered)).toBe(false)
    expect(answerAskValue(answered, null, 'ben', 'ignored')).toEqual(decision)
  })

  it('uses done for completed actions and rejects partial answer attribution', () => {
    const action: AskValue = {
      kind: 'action',
      q: 'Verify it',
      steps: ['Open the issue', 'Check the box'],
      by: 'agent',
      at: '2026-09-10T20:00:00.000Z',
    }
    expect(
      answerAskValue(action, 'done', 'ben', '2026-09-10T21:00:00.000Z'),
    ).toMatchObject({ answer: 'done', done: true, answered_by: 'ben' })
    expect(() =>
      serializeAsk({ ...decision, answer: 'yes' } as AskValue),
    ).toThrow(/answer, answered_by, and answered_at/)
  })
})

describe('openAskSummary', () => {
  const answered: AskValue = {
    ...decision,
    answer: 'B',
    answered_by: 'ben',
    answered_at: '2026-09-11T20:00:00.000Z',
  }

  it('reports no open ask for a bead carrying no ask metadata at all', () => {
    expect(openAskSummary(undefined)).toEqual({ open: false })
    expect(openAskSummary({ pr_url: 'https://example.test/pull/1' })).toEqual({
      open: false,
    })
  })

  it('reports no open ask once every ask carries an answer', () => {
    const metadata = { [askMetadataKey('storage')]: serializeAsk(answered) }
    expect(openAskSummary(metadata)).toEqual({ open: false })
    expect(hasOpenAsk(metadata)).toBe(false)
  })

  it('reports the soonest default_at among the OPEN asks', () => {
    expect(
      openAskSummary({
        [askMetadataKey('late')]: serializeAsk({
          ...decision,
          default_at: '2026-09-30T00:00:00.000Z',
        }),
        [askMetadataKey('soon')]: serializeAsk({
          ...decision,
          default_at: '2026-09-20T00:00:00.000Z',
        }),
        // An answered ask's deadline has already passed into the record.
        [askMetadataKey('settled')]: serializeAsk({
          ...answered,
          default_at: '2026-09-01T00:00:00.000Z',
        }),
      }),
    ).toEqual({ open: true, defaultAt: '2026-09-20T00:00:00.000Z' })
  })

  it('omits defaultAt when no open ask carries one', () => {
    expect(
      openAskSummary({ [askMetadataKey('storage')]: serializeAsk(decision) }),
    ).toEqual({ open: true })
  })

  it('treats unparseable ask metadata as an open ask rather than dropping it', () => {
    expect(openAskSummary({ 'ask.broken': '{' })).toEqual({ open: true })
    expect(hasOpenAsk({ 'ask.broken': '{' })).toBe(true)
  })
})
