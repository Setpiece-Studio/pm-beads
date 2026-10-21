// ABOUTME: Zod schemas and TypeScript types for bd CLI --json output: issues, dependencies,
// ABOUTME: epic status, and comments. Most optional fields are absent (not null); bd show's
// ABOUTME: linked-issue/comment arrays can also be explicit null, normalized to undefined.

import { z } from 'zod'

// bd supports custom statuses beyond the built-ins, so status stays a plain string
// with a helper to detect the well-known values.
export const knownStatuses = [
  'open',
  'in_progress',
  'blocked',
  'deferred',
  'closed',
] as const

export type KnownStatus = (typeof knownStatuses)[number]

export function isKnownStatus(status: string): status is KnownStatus {
  return (knownStatuses as readonly string[]).includes(status)
}

// bd supports custom types beyond the built-ins (and the `decision` type via config), so
// issue_type stays a plain string with a helper to detect the well-known values.
export const knownIssueTypes = [
  'task',
  'bug',
  'feature',
  'epic',
  'chore',
  'decision',
] as const

export type KnownIssueType = (typeof knownIssueTypes)[number]

export function isKnownIssueType(type: string): type is KnownIssueType {
  return (knownIssueTypes as readonly string[]).includes(type)
}

// Free-form JSON metadata. Values may be scalars, nested objects, or arrays;
// older writers also store structured values as JSON strings.
// Absent or explicitly null metadata means the issue carries none.
export const metadataSchema = z.preprocess(
  (v) => (v === null ? undefined : v),
  z.record(z.string(), z.json()).optional(),
)

// Fields shared by every issue representation bd emits.
const issueBaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.string(),
  priority: z.number().int(),
  issue_type: z.string(),
  owner: z.string().optional(),
  assignee: z.string().optional(),
  created_at: z.string(),
  created_by: z.string().optional(),
  updated_at: z.string(),
  closed_at: z.string().optional(),
  close_reason: z.string().optional(),
  notes: z.string().optional(),
  design: z.string().optional(),
  acceptance_criteria: z.string().optional(),
  labels: z.array(z.string()).optional(),
  parent: z.string().optional(),
  metadata: metadataSchema,
})

// Dependency edge record as embedded in bd list --json output. metadata is a JSON *string*.
export const dependencySchema = z.object({
  issue_id: z.string(),
  depends_on_id: z.string(),
  type: z.string(),
  created_at: z.string().optional(),
  created_by: z.string().optional(),
  metadata: z.string().optional(),
})

export type Dependency = z.infer<typeof dependencySchema>

// Issue as returned by bd list --json and bd create --json.
export const issueSchema = issueBaseSchema.extend({
  dependencies: z.array(dependencySchema).optional(),
  dependency_count: z.number().int().optional(),
  dependent_count: z.number().int().optional(),
  comment_count: z.number().int().optional(),
})

export type Issue = z.infer<typeof issueSchema>

// A message between Ben and an agent (or between agents): a bd bead of the infrastructure
// `message` type. Sender is created_by (bd stamps it from --actor), recipient is assignee, and
// read/unread is closed/open. bd creates these as ephemeral wisps (ids like pm-beads-wisp-xxx)
// and we deliberately never `bd promote` them — the durable record is the summary an agent
// writes into the related work bead. `ephemeral` is absent from issueSchema, which strips it.
export const messageSchema = issueSchema.extend({
  issue_type: z.literal('message'),
  ephemeral: z.literal(true),
})

export type Message = z.infer<typeof messageSchema>

// A reply chain, oldest first, rooted at the message that started it. Derived from a flat
// message list by buildThreads — bd stores only the per-reply `replies-to` edge, not the thread.
export const messageThreadSchema = z.object({
  rootId: z.string(),
  messages: z.array(messageSchema),
})

export type MessageThread = z.infer<typeof messageThreadSchema>

// What the inbox route loads for one scope. `viewer` is the human's canonical address: bd
// records senders and recipients as plain names, so the UI needs it to tell "from me" from
// "to me". It is assembled from env + a bd read rather than parsed, so no schema.
//
// `linkedIssues` holds the issues the threads point at via their `relates-to` edges, keyed by
// id — resolved server-side out of the cached issue list rather than one show per thread. An
// edge whose target is missing (deleted, or in another project) simply has no entry.
export interface Inbox {
  viewer: string
  threads: MessageThread[]
  linkedIssues: Record<string, Issue>
}

export const commentSchema = z.object({
  id: z.string(),
  issue_id: z.string(),
  author: z.string(),
  text: z.string(),
  created_at: z.string(),
})

export type Comment = z.infer<typeof commentSchema>

export const memorySchema = z.object({
  key: z.string(),
  value: z.string(),
})

export type Memory = z.infer<typeof memorySchema>

export const recallMemorySchema = memorySchema.extend({
  found: z.boolean(),
})

export type RecallMemory = z.infer<typeof recallMemorySchema>

// In bd show --json, dependencies/dependents are FULL issues annotated with dependency_type
// (parent-child | blocks | ...), unlike the edge records bd list embeds.
export const linkedIssueSchema = issueBaseSchema.extend({
  dependency_type: z.string(),
})

export type LinkedIssue = z.infer<typeof linkedIssueSchema>

// bd show emits these arrays as ABSENT or explicit null (KTD14). Coalescing null→undefined
// before the optional array validator keeps the property genuinely optional in the inferred
// type while tolerating an explicit "dependents": null that would otherwise crash getIssue.
function nullableArray<T extends z.ZodTypeAny>(element: T) {
  return z.preprocess(
    (v) => (v === null ? undefined : v),
    z.array(element).optional(),
  )
}

// Issue as returned by bd show --json (a single-element array of these), including
// linked issues and inline comments.
export const showIssueSchema = issueBaseSchema.extend({
  dependencies: nullableArray(linkedIssueSchema),
  dependents: nullableArray(linkedIssueSchema),
  comments: nullableArray(commentSchema),
})

export type ShowIssue = z.infer<typeof showIssueSchema>

// Element of bd history <id> --json — one dolt commit that touched the issue, carrying a full
// snapshot of the issue row AT that commit. The PascalCase keys are dolt's, not bd's. Committer
// is the dolt commit author ("root"/"beads"), never a human, so it is not an activity actor.
// The snapshot is narrower than bd list's issue: labels, parent, and dependencies are absent,
// so label/parent/dependency changes are invisible to history-derived activity.
export const historyEntrySchema = z.object({
  CommitHash: z.string(),
  Committer: z.string().optional(),
  CommitDate: z.string(),
  Issue: issueSchema,
})

export type HistoryEntry = z.infer<typeof historyEntrySchema>

// Element of bd epic status --json — the source of truth for epic progress.
export const epicStatusSchema = z.object({
  epic: issueSchema,
  total_children: z.number().int(),
  closed_children: z.number().int(),
  eligible_for_close: z.boolean(),
})

export type EpicStatus = z.infer<typeof epicStatusSchema>
