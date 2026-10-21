// ABOUTME: Typed write operations over the bd CLI: issues, labels, dependencies, comments,
// ABOUTME: messages, and memories. All writes serialize through the cli.ts lock (embedded dolt single-writer).

import { z } from 'zod'
import {
  answerAskValue,
  askMetadataKey,
  isAskOpen,
  parseAsks,
  serializeAsk,
} from './asks'
import { invalidateBdCache } from './cache'
import { type BdOptions, runBdWrite, runBdWriteJson } from './cli'
import {
  ACK_COMMENT_METADATA_KEY,
  humanAddress,
  MESSAGE_ISSUE_TYPE,
  MESSAGE_KIND_METADATA_KEY,
  type MessageKind,
  messageRelatesToIds,
  RELATES_TO_DEPENDENCY_TYPE,
  REPLY_TO_DEPENDENCY_TYPE,
} from './messages'
import { PR_URL_METADATA_KEY } from './pr-link'
import {
  getIssue,
  getIssueActivity,
  getMessage,
  type IssueActivity,
  listIssueComments,
} from './queries'
import {
  type Issue,
  issueSchema,
  type Message,
  messageSchema,
  type ShowIssue,
} from './types'

/**
 * Every field `updateIssue` can write. Declared as a schema rather than a bare interface so the
 * server function's validator is derived from it instead of restated: an added field that the
 * validator did not know about was silently stripped in transit, leaving updateIssue with nothing
 * to write and the UI reporting a refused save with no clue why.
 */
export const updateIssueFieldsSchema = z.object({
  status: z.string().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  assignee: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  notes: z.string().optional(),
  design: z.string().optional(),
  /** bd spells this `--acceptance`; the field keeps the name the issue carries. */
  acceptance_criteria: z.string().optional(),
  issue_type: z.string().optional(),
  /** Re-parent the issue (bd update --parent). Set AFTER create so the child keeps a flat id —
   * bd create --parent mints a dotted hierarchical id instead. Deliberately NOT reachable over
   * the wire; the server function omits it. */
  parent: z.string().optional(),
})

export type UpdateIssueFields = z.infer<typeof updateIssueFieldsSchema>

/** Update any subset of fields in one bd call, then return the fresh issue.
 * Labels are NOT updatable here — bd update silently ignores them; use addLabel/removeLabel. */
export async function updateIssue(
  id: string,
  fields: UpdateIssueFields,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  const args = ['update', id]
  if (fields.status !== undefined) args.push('--status', fields.status)
  if (fields.priority !== undefined)
    args.push('--priority', String(fields.priority))
  if (fields.assignee !== undefined) args.push('--assignee', fields.assignee)
  if (fields.issue_type !== undefined) args.push('--type', fields.issue_type)
  if (fields.title !== undefined) args.push('--title', fields.title)
  if (fields.description !== undefined)
    args.push('--description', fields.description)
  if (fields.notes !== undefined) args.push('--notes', fields.notes)
  if (fields.design !== undefined) args.push('--design', fields.design)
  if (fields.acceptance_criteria !== undefined)
    args.push('--acceptance', fields.acceptance_criteria)
  if (fields.parent !== undefined) args.push('--parent', fields.parent)
  if (args.length === 2) throw new Error('updateIssue: no fields to update')
  await runBdWrite(args, opts)
  invalidateBdCache(opts)
  return getIssue(id, opts)
}

/**
 * The free-text fields a person edits a whole field at a time, and the only ones a save can
 * silently clobber: every one of them is written as a complete replacement, so a save built on
 * text someone else has since rewritten erases that rewrite with no trace. Deliberately a subset
 * of `updateIssueFieldsSchema` — status, priority and the rest are single values a person picks
 * from what the screen currently shows, with nothing underneath to lose.
 */
export const guardedTextFieldSchema = z.enum([
  'title',
  'description',
  'design',
  'acceptance_criteria',
  'notes',
])

export type GuardedTextField = z.infer<typeof guardedTextFieldSchema>

/** What one guarded save did: the write landed, or it was refused because the stored text had
 * moved. Both carry a fresh issue — on success the state after the write, on a conflict the
 * state the editor was about to overwrite, so the caller can show it rather than just refuse. */
export type TextFieldSaveResult =
  | { ok: true; issue: ShowIssue }
  | {
      ok: false
      issue: ShowIssue
      conflict: { field: GuardedTextField; current: string }
    }

/**
 * Write one whole-field text edit, but only while the stored value is still the one the editor
 * opened with — a compare-and-set over `bd update`.
 *
 * `baseline` is the text the person actually read before typing over it. When bd holds something
 * else, an agent (or another window) rewrote the field while the editor was open, and writing the
 * draft would erase that silently; the save is refused instead and the incoming text comes back
 * with it. The caller keeps the draft and decides.
 *
 * The cost is one extra `bd show` ahead of the write — paid per prose save, which is human-paced,
 * never per keystroke. It cannot be avoided: the read-back `updateIssue` already does happens
 * AFTER the write and so only ever reports our own text. bd offers no conditional write, so a
 * concurrent `bd update` landing between this read and the write still wins; the window shrinks
 * from however long the editor was open to the gap between two adjacent bd calls.
 */
export async function saveTextField(
  id: string,
  field: GuardedTextField,
  value: string,
  baseline: string,
  opts: BdOptions = {},
): Promise<TextFieldSaveResult> {
  const before = await getIssue(id, opts)
  // An unset long-text field comes back absent, which is the same thing to a reader as empty.
  const current = before[field] ?? ''
  if (current !== baseline) {
    return { ok: false, issue: before, conflict: { field, current } }
  }
  return { ok: true, issue: await updateIssue(id, { [field]: value }, opts) }
}

/** Replace one ask JSON value and its status transition in the same bd update invocation. */
export async function answerAsk(
  id: string,
  key: string,
  answer: string | null,
  actor = humanAddress(),
  opts: BdOptions = {},
): Promise<ShowIssue> {
  const issue = await getIssue(id, opts)
  const parsed = parseAsks(issue.metadata)
  const current = parsed.asks.find((ask) => ask.key === key)
  if (!current) {
    const metadataKey = askMetadataKey(key)
    if (parsed.invalidKeys.includes(metadataKey)) {
      throw new Error(`Cannot answer malformed ask metadata: ${metadataKey}`)
    }
    throw new Error(`Ask not found: ${metadataKey}`)
  }

  const { key: _key, ...currentValue } = current
  const updated = answerAskValue(
    currentValue,
    answer,
    actor,
    new Date().toISOString(),
  )
  // An invalid ask may be open, so it must prevent the automatic blocked -> open
  // transition until a person repairs the metadata.
  const hasOpenAsk =
    parsed.invalidKeys.length > 0 ||
    parsed.asks.some((ask) =>
      ask.key === key ? isAskOpen(updated) : isAskOpen(ask),
    )
  const args = [
    'update',
    id,
    '--set-metadata',
    `${askMetadataKey(key)}=${serializeAsk(updated)}`,
    '--actor',
    actor,
  ]
  if (hasOpenAsk && issue.status !== 'blocked') args.push('--status', 'blocked')
  if (!hasOpenAsk && issue.status === 'blocked') args.push('--status', 'open')

  await runBdWrite(args, opts)
  invalidateBdCache(opts)
  return getIssue(id, opts)
}

export async function closeIssue(
  id: string,
  reason?: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  const args = ['close', id]
  if (reason !== undefined) args.push('--reason', reason)
  await runBdWrite(args, opts)
  invalidateBdCache(opts)
  return getIssue(id, opts)
}

export interface CreateIssueInput {
  title: string
  type: string
  priority: number
  description?: string
  assignee?: string
  labels?: string[]
  design?: string
  acceptance_criteria?: string
  notes?: string
  prUrl?: string
}

/** bd create --json returns the created issue as a single object (not an array). */
export async function createIssue(
  input: CreateIssueInput,
  opts: BdOptions = {},
): Promise<Issue> {
  const args = [
    'create',
    input.title,
    '--type',
    input.type,
    '--priority',
    String(input.priority),
    '--json',
  ]
  if (input.description !== undefined)
    args.push('--description', input.description)
  for (const [flag, value] of [
    ['--assignee', input.assignee],
    ['--design', input.design],
    ['--acceptance', input.acceptance_criteria],
    ['--notes', input.notes],
  ] as const)
    if (value !== undefined) args.push(flag, value)
  if (input.labels?.length) args.push('--labels', input.labels.join(','))
  if (input.prUrl)
    args.push('--metadata', JSON.stringify({ pr_url: input.prUrl }))
  const raw = await runBdWriteJson(args, opts)
  invalidateBdCache(opts)
  return issueSchema.parse(raw)
}

export interface CreateSubIssueInput extends CreateIssueInput {
  /** Issue the new child is filed under. */
  parentId: string
  assignee?: string
  labels?: string[]
}

/**
 * Create a child issue under `parentId`. Deliberately two steps: bd create FLAT, then bd update
 * --parent. `bd create --parent` mints a dotted hierarchical id (pm-beads-xi5.1) that reads as a
 * separate id namespace; creating flat and re-parenting keeps every issue in the project's one
 * flat id sequence. Assignee rides along on the same update call; labels follow via bd label add
 * (bd update --label silently no-ops). Returns the fresh child so the caller renders it directly
 * instead of re-reading. Every step routes through the cli.ts write lock.
 */
export async function createSubIssue(
  input: CreateSubIssueInput,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  const { parentId, assignee, labels, ...create } = input
  const created = await createIssue(create, opts)
  const fields: UpdateIssueFields = { parent: parentId }
  if (assignee !== undefined && assignee.trim() !== '')
    fields.assignee = assignee.trim()
  let issue = await updateIssue(created.id, fields, opts)
  for (const label of labels ?? []) {
    issue = await addLabel(created.id, label, opts)
  }
  return issue
}

export interface SendMessageInput {
  /** Recipient address — becomes the message bead's assignee. */
  to: string
  /** Message subject — the bead's title. */
  subject: string
  /** Message body — the bead's description. */
  body: string
  /** Id of the message being answered; chains this one onto that thread. */
  replyTo?: string
  /** Ids of every issue the conversation is about; each gets its own `relates-to` edge. A
   * reply carries the whole thread's related beads, so none of them falls off the
   * conversation at the first answer. */
  issueIds?: readonly string[]
  /** @deprecated Single-issue alias for `issueIds`, kept for callers written before a message
   * could relate to more than one bead. Merged ahead of `issueIds`. */
  issueId?: string
  /** Sender identity. App-authored messages default to the configured human; agent tools can
   * provide their stable persona address explicitly. */
  from?: string
  /** Semantic message kind. Ordinary conversation omits metadata for backwards compatibility. */
  kind?: MessageKind
  /** Required by the acknowledgment helper; stored with `kind=ack` for queryable provenance. */
  commentId?: string
}

/**
 * Send a message as a bd message wisp. The wisp is deliberately NOT promoted: messages are
 * disposable, and the durable record is the summary an agent writes into the related work bead.
 *
 * `--actor` stamps created_by with the configured human address; without it bd falls back to
 * git user.name ("Ben Harper"), which the Mine scope filter would not recognize as Ben.
 */
export async function sendMessage(
  input: SendMessageInput,
  opts: BdOptions = {},
): Promise<Message> {
  const args = [
    'create',
    input.subject,
    '--type',
    MESSAGE_ISSUE_TYPE,
    '--description',
    input.body,
    '--assignee',
    input.to,
    '--actor',
    input.from ?? humanAddress(),
    '--json',
  ]
  if (input.kind !== undefined && input.kind !== 'message') {
    const metadata: Record<string, string> = {
      [MESSAGE_KIND_METADATA_KEY]: input.kind,
    }
    if (input.commentId !== undefined)
      metadata[ACK_COMMENT_METADATA_KEY] = input.commentId
    args.push('--metadata', JSON.stringify(metadata))
  }
  if (input.replyTo !== undefined)
    args.push('--deps', `${REPLY_TO_DEPENDENCY_TYPE}:${input.replyTo}`)
  // --deps repeats, one flag per edge: bd takes no comma-separated list here.
  for (const issueId of messageRelatesToIds(input))
    args.push('--deps', `${RELATES_TO_DEPENDENCY_TYPE}:${issueId}`)
  const raw = await runBdWriteJson(args, opts)
  invalidateBdCache(opts)
  // bd exits 0 and returns {"error": ...} when the bead was created but a --deps edge could
  // not be wired (e.g. an unknown reply target), so a plain schema parse would report a
  // confusing shape error. Surface bd's own message instead.
  if (raw !== null && typeof raw === 'object' && 'error' in raw) {
    throw new Error(
      `bd create failed: ${String((raw as { error: unknown }).error)}`,
    )
  }
  return messageSchema.parse(raw)
}

export interface SendAcknowledgmentInput {
  /** Stable persona address acknowledging receipt. */
  from: string
  /** Person or agent whose response is being acknowledged. */
  to: string
  /** Durable work bead the response belongs to. */
  issueId: string
  /** Exact comment being acknowledged. */
  commentId: string
  /** Optional context appended after the standard comment reference. */
  body?: string
}

/** Send a typed, ephemeral receipt for one durable work-bead comment. */
export async function sendAcknowledgment(
  input: SendAcknowledgmentInput,
  opts: BdOptions = {},
): Promise<Message> {
  const comment = (await listIssueComments(input.issueId, opts)).find(
    (candidate) => candidate.id === input.commentId,
  )
  if (comment === undefined) {
    throw new Error(
      `Comment ${input.commentId} does not belong to issue ${input.issueId}`,
    )
  }
  const suffix = input.body?.trim()
  return await sendMessage(
    {
      from: input.from,
      to: input.to,
      subject: 'Acknowledged response',
      body: `Acknowledged comment:${input.commentId}${suffix ? ` — ${suffix}` : ''}`,
      issueId: input.issueId,
      kind: 'ack',
      commentId: input.commentId,
    },
    opts,
  )
}

/** Mark a message read. Read/unread is bd's closed/open, so reading is just closing. */
export async function markMessageRead(
  id: string,
  opts: BdOptions = {},
): Promise<Message> {
  await markMessagesRead([id], opts)
  return getMessage(id, opts)
}

/** Mark several messages read in one bd write — the inbox's bulk action must not pay one CLI
 * process and one browser round trip per message. */
export async function markMessagesRead(
  ids: readonly string[],
  opts: BdOptions = {},
): Promise<void> {
  if (ids.length === 0) return
  await runBdWrite(['close', ...ids], opts)
  invalidateBdCache(opts)
}

/** Mark a message unread — the inverse of markMessageRead. There is no `bd reopen`, so this
 * sets the status back to open; bd clears closed_at as part of the transition. */
export async function markMessageUnread(
  id: string,
  opts: BdOptions = {},
): Promise<Message> {
  await runBdWrite(['update', id, '--status', 'open'], opts)
  invalidateBdCache(opts)
  return getMessage(id, opts)
}

/** Labels go through bd label add/remove — bd update --label silently no-ops. Returns the fresh
 * issue so the detail rail applies it directly instead of issuing a second serialized bd read. */
export async function addLabel(
  id: string,
  label: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  await runBdWrite(['label', 'add', id, label], opts)
  invalidateBdCache(opts)
  return getIssue(id, opts)
}

export async function removeLabel(
  id: string,
  label: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  await runBdWrite(['label', 'remove', id, label], opts)
  invalidateBdCache(opts)
  return getIssue(id, opts)
}

/** Link a pull request to an issue by writing the pr_url metadata key — the project convention
 * for "this bead's latest PR" (CONCEPTS.md). `url` is expected canonical (prRefUrl); resolving
 * a bare number against the project's origin remote happens one level up, in the server fn.
 * Returns the fresh issue so the rail applies it directly. */
export async function setPrUrl(
  id: string,
  url: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  await runBdWrite(
    ['update', id, '--set-metadata', `${PR_URL_METADATA_KEY}=${url}`],
    opts,
  )
  invalidateBdCache(opts)
  return getIssue(id, opts)
}

/** Unlink the pull request — drops the pr_url key entirely rather than blanking it, so
 * `bd list --has-metadata-key pr_url` stops matching the bead. */
export async function clearPrUrl(
  id: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  await runBdWrite(
    ['update', id, '--unset-metadata', PR_URL_METADATA_KEY],
    opts,
  )
  invalidateBdCache(opts)
  return getIssue(id, opts)
}

/** Add a directed dependency: issueId depends on (is blocked by) dependsOnId.
 * Argument order encodes direction — bd dep add <issue> <depends-on>. dependsOnId may
 * be a local id or an external reference (external:<project>:<capability>). Returns the fresh
 * issueId issue so the rail applies it directly rather than re-reading via getIssue. */
export async function addDependency(
  issueId: string,
  dependsOnId: string,
  type: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  await runBdWrite(['dep', 'add', issueId, dependsOnId, '--type', type], opts)
  invalidateBdCache(opts)
  return getIssue(issueId, opts)
}

/** Remove a directed dependency edge (issueId depends on dependsOnId). bd dep remove
 * resolves the edge by the order it was added, so callers pass the same (issue, depends-on)
 * order used to add it; a reversed call returns success but is a no-op in bd v1.0.0. Returns
 * the fresh issueId issue so the rail applies it directly. */
export async function removeDependency(
  issueId: string,
  dependsOnId: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  await runBdWrite(['dep', 'remove', issueId, dependsOnId], opts)
  invalidateBdCache(opts)
  return getIssue(issueId, opts)
}

/** Create a bidirectional relates-to link between two issues (order-insensitive). Returns the
 * fresh `a` issue so the rail (which edits from `a`'s perspective) applies it directly. */
export async function relateIssues(
  a: string,
  b: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  await runBdWrite(['dep', 'relate', a, b], opts)
  invalidateBdCache(opts)
  return getIssue(a, opts)
}

/** Remove a bidirectional relates-to link between two issues (order-insensitive). Returns the
 * fresh `a` issue so the rail applies it directly. */
export async function unrelateIssues(
  a: string,
  b: string,
  opts: BdOptions = {},
): Promise<ShowIssue> {
  await runBdWrite(['dep', 'unrelate', a, b], opts)
  invalidateBdCache(opts)
  return getIssue(a, opts)
}

/** Post a comment, then return the issue's fresh activity so the stream renders it without a
 * second client round trip. The `--` guard stops cobra parsing a body that starts with a dash
 * as a flag; execFile passes argv directly, so no shell quoting is involved. */
export async function addComment(
  id: string,
  text: string,
  opts: BdOptions = {},
): Promise<IssueActivity> {
  await runBdWrite(['comment', id, '--', text], opts)
  invalidateBdCache(opts)
  return getIssueActivity(id, opts)
}

/**
 * Post a comment SIGNED as the viewer — the inbox's reply composer.
 *
 * Unsigned, bd stamps the author from `BEADS_ACTOR` if the process has one and git `user.name`
 * otherwise, so the same reply reads as "claude" from an agent-launched dev server and
 * "Ben Harper" from Ben's. The activity feed filters on exactly that name, so a reply has to
 * carry the configured address the way `sendMessage` does — otherwise Ben's own answer comes
 * back to him as unread activity.
 */
export async function commentAsViewer(
  id: string,
  text: string,
  opts: BdOptions = {},
): Promise<IssueActivity> {
  await runBdWrite(['comment', id, '--actor', humanAddress(), '--', text], opts)
  invalidateBdCache(opts)
  return getIssueActivity(id, opts)
}

export async function deleteMemory(
  key: string,
  opts: BdOptions = {},
): Promise<void> {
  await runBdWrite(['forget', key], opts)
  invalidateBdCache(opts)
}
