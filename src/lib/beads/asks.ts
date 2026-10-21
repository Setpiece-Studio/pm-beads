// ABOUTME: Canonical schema and pure helpers for structured asks stored in bd metadata.
// ABOUTME: Reads JSON strings or objects; answers replace the whole value as a JSON string.

import { z } from 'zod'
import type { Issue } from './types'

export const ASK_METADATA_PREFIX = 'ask.'
export const askKinds = ['action', 'decision', 'check', 'review'] as const

const answerFields = {
  answer: z.string().trim().min(1).optional(),
  answered_by: z.string().trim().min(1).optional(),
  answered_at: z.iso.datetime({ offset: true }).optional(),
}

export const askValueSchema = z
  .strictObject({
    kind: z.enum(askKinds),
    q: z.string().trim().min(1),
    options: z.array(z.string().trim().min(1)).min(1).optional(),
    default: z.string().trim().min(1).optional(),
    default_at: z.iso.datetime({ offset: true }).optional(),
    by: z.string().trim().min(1),
    at: z.iso.datetime({ offset: true }),
    note: z.string().trim().min(1).optional(),
    steps: z.array(z.string().trim().min(1)).optional(),
    done: z.boolean().optional(),
    ...answerFields,
  })
  .superRefine((ask, context) => {
    const attributionCount = [
      ask.answer,
      ask.answered_by,
      ask.answered_at,
    ].filter((value) => value !== undefined).length
    if (attributionCount !== 0 && attributionCount !== 3) {
      context.addIssue({
        code: 'custom',
        message: 'answer, answered_by, and answered_at must be set together',
      })
    }
    if (ask.done !== undefined && ask.kind !== 'action') {
      context.addIssue({
        code: 'custom',
        path: ['done'],
        message: 'done is only valid for action asks',
      })
    }
    if (ask.kind === 'action' && ask.done === true && ask.answer !== 'done') {
      context.addIssue({
        code: 'custom',
        path: ['answer'],
        message: 'completed actions use answer "done"',
      })
    }
  })

export type AskValue = z.infer<typeof askValueSchema>
export type AskKind = AskValue['kind']
export interface Ask extends AskValue {
  key: string
}

export interface ParsedAsks {
  asks: Ask[]
  invalidKeys: string[]
}

// bd metadata keys permit letters, numbers, underscores, and dots (but not hyphens).
export const askKeySchema = z.string().regex(/^[a-z0-9_]+(?:\.[a-z0-9_]+)*$/i)

export function askMetadataKey(key: string): string {
  return `${ASK_METADATA_PREFIX}${askKeySchema.parse(key)}`
}

export function parseAsks(
  metadata: Record<string, unknown> | undefined,
): ParsedAsks {
  const asks: Ask[] = []
  const invalidKeys: string[] = []

  for (const [metadataKey, raw] of Object.entries(metadata ?? {})) {
    if (!metadataKey.startsWith(ASK_METADATA_PREFIX)) continue
    const key = metadataKey.slice(ASK_METADATA_PREFIX.length)
    if (!askKeySchema.safeParse(key).success) {
      invalidKeys.push(metadataKey)
      continue
    }
    try {
      const parsed = askValueSchema.safeParse(
        typeof raw === 'string' ? JSON.parse(raw) : raw,
      )
      if (!parsed.success) {
        invalidKeys.push(metadataKey)
        continue
      }
      asks.push({ key, ...parsed.data })
    } catch {
      invalidKeys.push(metadataKey)
    }
  }

  return { asks, invalidKeys }
}

export function isAskOpen(ask: AskValue): boolean {
  return ask.answer === undefined
}

/** What a bead's ask metadata says about whether a person still owes it an answer. */
export interface OpenAskSummary {
  /** True when the bead carries at least one ask nobody has answered. */
  open: boolean
  /** The soonest `default_at` among those open asks — when the first of them decides itself.
   * Absent when none of them carries one, which is how an undated ask is told apart from an
   * overdue one rather than by an invented date. */
  defaultAt?: string
}

/**
 * The ask state the "Needs you" filter and the merged-PR sweep both read.
 *
 * Unparseable ask metadata counts as OPEN. A malformed ask is still an ask somebody wrote, and
 * the one failure mode this filter must not have is a bead quietly leaving the queue because
 * its metadata could not be read — `parseAsks` already reports those keys so the bead detail
 * can show them for repair, and `answerAsk` already refuses the blocked → open transition
 * while any of them stand.
 */
export function openAskSummary(
  metadata: Record<string, unknown> | undefined,
): OpenAskSummary {
  const { asks, invalidKeys } = parseAsks(metadata)
  const open = asks.filter(isAskOpen)
  if (open.length === 0 && invalidKeys.length === 0) return { open: false }

  const defaultAt = open
    .map((ask) => ask.default_at)
    .filter((value): value is string => value !== undefined)
    .sort()[0]
  return defaultAt === undefined ? { open: true } : { open: true, defaultAt }
}

/** Whether a person still owes this bead an answer. The retired `human` label's meaning,
 * derived from the metadata instead of asserted alongside it. */
export function hasOpenAsk(
  metadata: Record<string, unknown> | undefined,
): boolean {
  return openAskSummary(metadata).open
}

export function serializeAsk(ask: AskValue): string {
  return JSON.stringify(askValueSchema.parse(ask))
}

/** The inbox queue: unfinished beads with unanswered (or malformed) asks. */
export function issuesWithOpenAsks(issues: readonly Issue[]): Issue[] {
  return issues.filter(
    (issue) => issue.status !== 'closed' && hasOpenAsk(issue.metadata),
  )
}

export function answerAskValue(
  ask: AskValue,
  answer: string | null,
  actor: string,
  answeredAt: string,
): AskValue {
  if (answer === null) {
    const {
      answer: _answer,
      answered_by: _answeredBy,
      answered_at: _answeredAt,
      done: _done,
      ...open
    } = ask
    return askValueSchema.parse(open)
  }

  const normalized = answer.trim()
  if (normalized === '') throw new Error('Ask answer cannot be empty')
  if (ask.kind === 'action' && normalized !== 'done') {
    throw new Error('Action asks can only be answered with "done"')
  }
  return askValueSchema.parse({
    ...ask,
    answer: normalized,
    answered_by: actor,
    answered_at: answeredAt,
    ...(ask.kind === 'action' ? { done: true } : {}),
  })
}
