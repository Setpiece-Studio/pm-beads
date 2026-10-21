// ABOUTME: Integration tests for the message data layer against a real throwaway beads project
// ABOUTME: created with `bd init` in a temp dir, exercising send, list, thread, and mark-read.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'

// bd writes wait on the embedded dolt exclusive lock; a too-small timeout kills a
// test mid-write and the orphaned bd process cascades lock failures into later tests.
vi.setConfig({ testTimeout: 60_000 })

import { clearBdCachesForTest } from '../cache'
import { runBd } from '../cli'
import {
  acknowledgedCommentId,
  linkedIssueId,
  messageKind,
  parentMessageId,
  threadIssueId,
} from '../messages'
import {
  addComment,
  createIssue,
  markMessageRead,
  markMessageUnread,
  sendAcknowledgment,
  sendMessage,
} from '../mutations'
import {
  countUnreadMessages,
  getMessage,
  getThread,
  listIssues,
  listMessages,
  readInbox,
} from '../queries'

let dir: string
let rootId: string
let replyId: string
let agentToAgentId: string

beforeAll(async () => {
  vi.stubEnv('PM_BEADS_USER', 'ben')
  dir = mkdtempSync(join(tmpdir(), 'pm-beads-msgtest-'))
  await runBd(['init', '--prefix', 'tst'], {
    cwd: dir,
    env: { BD_NON_INTERACTIVE: '1' },
  })

  const root = await sendMessage(
    {
      to: 'agent-a',
      subject: 'Please look at the cache',
      body: 'Details here',
    },
    { cwd: dir },
  )
  rootId = root.id
  const reply = await sendMessage(
    { to: 'ben', subject: 'Re: cache', body: 'On it', replyTo: rootId },
    { cwd: dir },
  )
  replyId = reply.id
  // A message with the human at neither end, for the Agents scope.
  await runBd(
    [
      'create',
      'Agent chatter',
      '--type',
      'message',
      '--description',
      'between agents',
      '--assignee',
      'agent-b',
      '--actor',
      'agent-a',
    ],
    { cwd: dir },
  )
  const chatter = (await listMessages({ scope: 'agents' }, { cwd: dir }))[0]
  if (!chatter) throw new Error('agent-to-agent message was not created')
  agentToAgentId = chatter.id
}, 120_000)

afterAll(() => {
  vi.unstubAllEnvs()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  clearBdCachesForTest()
})

it('sends a message as an ephemeral wisp addressed to the recipient', async () => {
  const messages = await listMessages({}, { cwd: dir })
  const root = messages.find((message) => message.id === rootId)

  expect(root).toMatchObject({
    title: 'Please look at the cache',
    description: 'Details here',
    issue_type: 'message',
    ephemeral: true,
    assignee: 'agent-a',
    created_by: 'ben',
    status: 'open',
  })
  expect(rootId).toContain('wisp')
})

it('keeps messages out of the ordinary issue list', async () => {
  const issues = await listIssues({ all: true }, { cwd: dir })

  expect(issues.map((issue) => issue.id)).not.toContain(rootId)
})

it('scopes the inbox by whether the human is a party', async () => {
  const mine = await listMessages({ scope: 'mine' }, { cwd: dir })
  const agents = await listMessages({ scope: 'agents' }, { cwd: dir })

  expect(mine.map((message) => message.id).sort()).toEqual(
    [rootId, replyId].sort(),
  )
  expect(agents.map((message) => message.id)).toEqual([agentToAgentId])
})

it('chains a reply onto its parent thread', async () => {
  const thread = await getThread(replyId, { cwd: dir })

  expect(thread.rootId).toBe(rootId)
  expect(thread.messages.map((message) => message.id)).toEqual([
    rootId,
    replyId,
  ])
})

it('rejects a thread lookup for an unknown message', async () => {
  await expect(getThread('tst-wisp-nope', { cwd: dir })).rejects.toThrow(
    'Message not found: tst-wisp-nope',
  )
})

it('marks a message read by closing it, hiding it from the unread inbox', async () => {
  const read = await markMessageRead(rootId, { cwd: dir })
  expect(read.status).toBe('closed')

  const unread = await listMessages({}, { cwd: dir })
  expect(unread.map((message) => message.id)).not.toContain(rootId)

  const withRead = await listMessages({ includeClosed: true }, { cwd: dir })
  expect(withRead.map((message) => message.id)).toContain(rootId)

  // A read message is still part of its thread.
  const thread = await getThread(replyId, { cwd: dir })
  expect(thread.messages.map((message) => message.id)).toEqual([
    rootId,
    replyId,
  ])
})

it('marks a message unread again by reopening it', async () => {
  const unread = await markMessageUnread(rootId, { cwd: dir })
  expect(unread.status).toBe('open')

  const inbox = await listMessages({}, { cwd: dir })
  expect(inbox.map((message) => message.id)).toContain(rootId)
})

it('reads an inbox of whole threads for a scope, viewer and all', async () => {
  const mine = await readInbox({ scope: 'mine' }, { cwd: dir })

  expect(mine.viewer).toBe('ben')
  expect(mine.threads).toHaveLength(1)
  expect(mine.threads[0]?.messages.map((message) => message.id)).toEqual([
    rootId,
    replyId,
  ])

  const agents = await readInbox({ scope: 'agents' }, { cwd: dir })
  expect(agents.threads.map((thread) => thread.rootId)).toEqual([
    agentToAgentId,
  ])
})

it('counts only open messages addressed to the human', async () => {
  // rootId went TO agent-a and the agent chatter to agent-b; only the reply is Ben's.
  expect(await countUnreadMessages({ cwd: dir })).toBe(1)

  await markMessageRead(replyId, { cwd: dir })
  expect(await countUnreadMessages({ cwd: dir })).toBe(0)
})

it('links a message to an issue and resolves it onto the thread', async () => {
  const issue = await createIssue(
    {
      title: 'Cache read is slow',
      type: 'task',
      priority: 1,
      description: 'Profile the bd list read.',
    },
    { cwd: dir },
  )

  const linked = await sendMessage(
    {
      to: 'agent-a',
      subject: 'About the cache',
      body: 'See the issue',
      issueId: issue.id,
    },
    { cwd: dir },
  )
  // bd wires an ephemeral wisp → permanent issue `relates-to` edge and returns it on the
  // message's own dependencies array.
  const stored = await getMessage(linked.id, { cwd: dir })
  expect(stored.dependencies).toContainEqual(
    expect.objectContaining({
      type: 'relates-to',
      issue_id: linked.id,
      depends_on_id: issue.id,
    }),
  )
  expect(linkedIssueId(stored)).toBe(issue.id)

  // A reply carrying the inherited link keeps BOTH edges.
  const reply = await sendMessage(
    {
      to: 'ben',
      subject: 'Re: About the cache',
      body: 'Looking',
      replyTo: linked.id,
      issueId: issue.id,
    },
    { cwd: dir },
  )
  const storedReply = await getMessage(reply.id, { cwd: dir })
  expect(parentMessageId(storedReply)).toBe(linked.id)
  expect(linkedIssueId(storedReply)).toBe(issue.id)

  // The inbox resolves the link to the whole issue, description included.
  const inbox = await readInbox({ scope: 'mine' }, { cwd: dir })
  const thread = inbox.threads.find(
    (candidate) => candidate.rootId === linked.id,
  )
  if (thread === undefined) throw new Error('linked thread missing from inbox')
  expect(threadIssueId(thread)).toBe(issue.id)
  expect(inbox.linkedIssues[issue.id]).toMatchObject({
    id: issue.id,
    title: 'Cache read is slow',
    description: 'Profile the bd list read.',
  })
})

it('leaves linkedIssues empty for an inbox whose threads are unlinked', async () => {
  const agents = await readInbox({ scope: 'agents' }, { cwd: dir })

  expect(agents.linkedIssues).toEqual({})
})

it('sends a typed acknowledgment tied to a work bead and comment', async () => {
  const issue = await createIssue(
    { title: 'Approve launch', type: 'task', priority: 1 },
    { cwd: dir },
  )
  const response = await addComment(issue.id, 'Approved', { cwd: dir })
  const commentId = response.comments.at(-1)?.id
  if (commentId === undefined)
    throw new Error('response comment was not created')
  const ack = await sendAcknowledgment(
    {
      from: 'agent-a',
      to: 'ben',
      issueId: issue.id,
      commentId,
      body: 'Starting now',
    },
    { cwd: dir },
  )
  expect(ack).toMatchObject({
    ephemeral: true,
    created_by: 'agent-a',
    assignee: 'ben',
    description: `Acknowledged comment:${commentId} — Starting now`,
  })
  expect(messageKind(ack)).toBe('ack')
  expect(acknowledgedCommentId(ack)).toBe(commentId)
  // bd create's response omits dependency rows; the stored wisp carries the durable link.
  expect(linkedIssueId(await getMessage(ack.id, { cwd: dir }))).toBe(issue.id)
})
