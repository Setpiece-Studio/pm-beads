// ABOUTME: Finds persona-addressed activity and messages, then rings idle agent panes via tmux.
// ABOUTME: Delivery is stamped only after send-keys succeeds, so missing/busy panes retry.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  type ActivityFeed,
  type ActivityItem,
  listActivityItems,
} from './inbox-activity'
import { isHumanAddress, messageKind } from './messages'
import {
  type NotifierConfig,
  readNotifierConfig,
  recordDeliveredActivity,
} from './notifier-store'
import { listMessages } from './queries'
import type { Message } from './types'

const execFileAsync = promisify(execFile)

export interface TmuxClient {
  hasSession(session: string): Promise<boolean>
  capturePane(session: string): Promise<string>
  sendMessage(session: string, message: string): Promise<void>
}

export const tmuxClient: TmuxClient = {
  async hasSession(session) {
    try {
      await execFileAsync('tmux', ['has-session', '-t', session])
      return true
    } catch {
      return false
    }
  },
  async capturePane(session) {
    const { stdout } = await execFileAsync('tmux', [
      'capture-pane',
      '-p',
      '-t',
      session,
      '-S',
      '-20',
    ])
    return stdout
  },
  async sendMessage(session, message) {
    // Literal mode keeps comment actors and bead ids out of tmux's key-name parser.
    await execFileAsync('tmux', ['send-keys', '-t', session, '-l', message])
    await execFileAsync('tmux', ['send-keys', '-t', session, 'Enter'])
  },
}

/** Codex and Claude Code render their input prompt with these glyphs. Looking only at the
 * last nonblank row avoids interrupting an agent whose old prompt remains in scrollback. */
export function paneIsAtAgentPrompt(capture: string): boolean {
  const last = capture
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  return last !== undefined && /^[›❯]$/u.test(last)
}

type ActivityReader = (
  projectDir: string,
  viewer: readonly string[],
) => Promise<ActivityFeed>
type MessageReader = (projectDir: string) => Promise<Message[]>

export interface NotifyDependencies {
  config?: NotifierConfig
  readActivity?: ActivityReader
  readMessages?: MessageReader
  tmux?: TmuxClient
  recordDelivered?: (projectDir: string, activityId: string) => Promise<void>
}

export interface NotifyResult {
  delivered: string[]
  deferred: string[]
}

function activityNotificationText(item: ActivityItem): string {
  return `New comment from ${item.actor} on ${item.issueId}. Read it.`
}

function messageNotificationText(message: Message): string {
  return `New message from ${message.created_by ?? 'unknown'} (${message.id}). Read it.`
}

interface NotificationCandidate {
  id: string
  createdAt: string
  text: string
}

async function unreadMessages(projectDir: string): Promise<Message[]> {
  return listMessages({}, { cwd: projectDir })
}

/** Deliver at most one item per persona per pass. After the first send the pane is no longer
 * at its prompt, so explicitly stopping also makes that behavior deterministic in tests. */
export async function notifyProject(
  projectDir: string,
  dependencies: NotifyDependencies = {},
): Promise<NotifyResult> {
  const config = dependencies.config ?? readNotifierConfig(projectDir)
  const readActivity = dependencies.readActivity ?? listActivityItems
  const readMessages = dependencies.readMessages ?? unreadMessages
  const tmux = dependencies.tmux ?? tmuxClient
  const stamp = dependencies.recordDelivered ?? recordDeliveredActivity
  const deliveredIds = new Set(config.deliveredActivityIds)
  const result: NotifyResult = { delivered: [], deferred: [] }
  let projectMessages: Message[] | undefined

  for (const [key, persona] of Object.entries(config.personas)) {
    if (persona.tmux === undefined) continue
    const viewer = [key, ...(persona.aliases ?? [])]
    const feed = await readActivity(projectDir, viewer)
    if (projectMessages === undefined) {
      try {
        projectMessages = await readMessages(projectDir)
      } catch (error) {
        // Message delivery is additive. A degraded message read must not break the established
        // mention/comment notifier path for this project.
        console.warn(
          `[pm-beads] notifier could not read messages for ${projectDir}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        projectMessages = []
      }
    }
    const candidates: NotificationCandidate[] = [
      ...feed.items.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        text: activityNotificationText(item),
      })),
      ...projectMessages
        .filter(
          (message) =>
            messageKind(message) === 'message' &&
            isHumanAddress(message.assignee, viewer),
        )
        .map((message) => ({
          id: `message:${message.id}`,
          createdAt: message.created_at,
          text: messageNotificationText(message),
        })),
    ]
      .filter((candidate) => !deliveredIds.has(candidate.id))
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
      )
    const candidate = candidates[0]
    if (candidate === undefined) continue

    try {
      if (!(await tmux.hasSession(persona.tmux))) {
        result.deferred.push(candidate.id)
        continue
      }
      const capture = await tmux.capturePane(persona.tmux)
      if (!paneIsAtAgentPrompt(capture)) {
        result.deferred.push(candidate.id)
        continue
      }

      await tmux.sendMessage(persona.tmux, candidate.text)
      await stamp(projectDir, candidate.id)
      deliveredIds.add(candidate.id)
      result.delivered.push(candidate.id)
    } catch {
      // A pane can disappear between has-session and capture/send. It is still undelivered.
      result.deferred.push(candidate.id)
    }
  }

  return result
}
