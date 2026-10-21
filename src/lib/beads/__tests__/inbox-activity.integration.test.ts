// ABOUTME: Integration test for the inbox activity fetch against two real throwaway bd projects
// ABOUTME: seeded identically — one in server mode (bd sql) and one embedded (bd list fallback).

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

// bd writes wait on the embedded dolt exclusive lock; a too-small timeout kills a
// test mid-write and the orphaned bd process cascades lock failures into later tests.
vi.setConfig({ testTimeout: 120_000 })

import { type AskValue, askMetadataKey, serializeAsk } from '../asks'
import { runBd, runBdJson } from '../cli'
import {
  type ActivityItem,
  activitySnapshotQueries,
  clearActivitySourceCacheForTest,
  fetchActivitySnapshotViaCli,
  fetchActivitySnapshotViaSql,
  listActivityItems,
  selectActivityItems,
} from '../inbox-activity'
import { answerAsk } from '../mutations'

const VIEWER = ['ben', 'Ben Harper']
/** Everything the seed creates is minutes old, so any floor well before the seed keeps it all. */
const SINCE = '2020-01-01T00:00:00Z'

const ASK_KEY = 'rollout_order'
const ROLLOUT_ASK: AskValue = {
  kind: 'decision',
  q: 'Which order do you want?',
  options: ['A: renderer', '★B: exporter'],
  default: 'B',
  default_at: '2026-09-20T00:00:00.000Z',
  by: 'infra-engineer',
  at: '2026-09-01T00:00:00.000Z',
}

interface Seeded {
  dir: string
  mineId: string
  askId: string
  mentionId: string
  strangerId: string
}

let server: Seeded
let embedded: Seeded

async function createIssue(
  dir: string,
  title: string,
  actor: string,
): Promise<string> {
  const created = (await runBdJson(
    [
      'create',
      title,
      '--type',
      'task',
      '--priority',
      '1',
      '--actor',
      actor,
      '--json',
    ],
    { cwd: dir },
  )) as { id: string }
  return created.id
}

/** The same four beads in either backend: one the viewer created, one carrying an open ask, one
 * that mentions the viewer, and one that concerns the viewer in no way at all. */
async function seed(dir: string, mode: 'server' | 'embedded'): Promise<Seeded> {
  const args = ['init', '--prefix', mode === 'server' ? 'srv' : 'emb']
  if (mode === 'server') args.splice(1, 0, '--server')
  await runBd(args, { cwd: dir, env: { BD_NON_INTERACTIVE: '1' } })

  const mineId = await createIssue(dir, 'Cache read is slow', 'ben')
  await runBd(
    [
      'comment',
      mineId,
      '--actor',
      'infra-engineer',
      '--',
      'Profiled it — the list read dominates.',
    ],
    { cwd: dir },
  )
  await runBd(
    ['comment', mineId, '--actor', 'ben', '--', 'Thanks, looking now.'],
    { cwd: dir },
  )

  const askId = await createIssue(dir, 'Pick a rollout order', 'infra-engineer')
  // Posted from the CLI with --set-metadata alone, which is the whole point of the derived
  // filter: nothing else — no label, no message — has to be kept in step with it.
  await runBd(
    [
      'update',
      askId,
      '--set-metadata',
      `${askMetadataKey(ASK_KEY)}=${serializeAsk(ROLLOUT_ASK)}`,
      '--actor',
      'infra-engineer',
    ],
    { cwd: dir },
  )
  await runBd(
    [
      'comment',
      askId,
      '--actor',
      'infra-engineer',
      '--',
      'Which order do you want? @ben',
    ],
    { cwd: dir },
  )

  const mentionId = await createIssue(dir, 'Someone else’s bead', 'agent-x')
  await runBd(['update', mentionId, '--assignee', 'agent-x'], { cwd: dir })
  await runBd(
    [
      'comment',
      mentionId,
      '--actor',
      'agent-x',
      '--',
      'cc @ben before I land this',
    ],
    { cwd: dir },
  )

  const strangerId = await createIssue(dir, 'Nothing to do with Ben', 'agent-y')
  await runBd(['update', strangerId, '--assignee', 'agent-y'], { cwd: dir })
  await runBd(
    ['comment', strangerId, '--actor', 'agent-y', '--', 'internal note'],
    { cwd: dir },
  )

  return { dir, mineId, askId, mentionId, strangerId }
}

/**
 * Items minus their bd-minted ids, so the two backends can be compared row for row: each
 * project mints its own prefix. Sorted by title rather than left in feed order — the seed
 * writes all four beads inside one second and bd stores whole seconds, so feed order comes
 * down to an id tiebreak that differs between the two projects. Ordering is a unit-test
 * concern; what matters here is that both paths see the same items.
 */
function shape(items: readonly ActivityItem[]) {
  return items
    .map(({ kind, issueTitle, issueStatus, actor, text }) => ({
      kind,
      issueTitle,
      issueStatus,
      actor,
      text,
    }))
    .sort((a, b) => a.issueTitle.localeCompare(b.issueTitle))
}

beforeAll(async () => {
  vi.stubEnv('PM_BEADS_USER', VIEWER.join(','))
  server = await seed(
    mkdtempSync(join(tmpdir(), 'pm-beads-activity-server-')),
    'server',
  )
  embedded = await seed(
    mkdtempSync(join(tmpdir(), 'pm-beads-activity-embedded-')),
    'embedded',
  )
}, 300_000)

afterAll(async () => {
  vi.unstubAllEnvs()
  clearActivitySourceCacheForTest()
  // The server-mode project left a dolt sql-server running in a temp dir; stop it before the
  // directory disappears out from under it.
  if (server?.dir) {
    try {
      await runBd(['dolt', 'stop'], { cwd: server.dir })
    } catch {
      // Already gone — nothing to clean up.
    }
    rmSync(server.dir, { recursive: true, force: true })
  }
  if (embedded?.dir) rmSync(embedded.dir, { recursive: true, force: true })
})

it('runs the activity queries against bd’s real schema', async () => {
  // The schema-drift guard: bd's tables are internal, so a renamed column or table has to fail
  // here — loudly, naming the query — rather than silently degrading the inbox to the fallback.
  const queries = activitySnapshotQueries(SINCE)
  for (const [name, sql] of Object.entries(queries)) {
    await expect(
      runBdJson(['sql', sql, '--json'], { cwd: server.dir }),
      `activity ${name} query no longer runs against bd's schema:\n${sql}`,
    ).resolves.toBeDefined()
  }
})

it('refuses bd sql on an embedded project', async () => {
  await expect(
    runBd(['sql', 'SELECT 1', '--json'], { cwd: embedded.dir }),
  ).rejects.toThrow(/embedded mode/i)
})

it('reads the same snapshot through bd sql and the bd list fallback', async () => {
  const viaSql = selectActivityItems(
    await fetchActivitySnapshotViaSql(SINCE, { cwd: server.dir }),
    { viewer: VIEWER, since: SINCE },
  )
  const viaCli = selectActivityItems(
    await fetchActivitySnapshotViaCli(SINCE, VIEWER, { cwd: embedded.dir }),
    { viewer: VIEWER, since: SINCE },
  )

  expect(shape(viaSql)).toEqual(shape(viaCli))
  expect(shape(viaSql)).toEqual([
    {
      kind: 'comment',
      issueTitle: 'Cache read is slow',
      issueStatus: 'open',
      actor: 'infra-engineer',
      // Ben's own reply on his own bead is not activity; the agent's comment is.
      text: 'Profiled it — the list read dominates.',
    },
    {
      kind: 'ask',
      issueTitle: 'Pick a rollout order',
      issueStatus: 'open',
      actor: 'infra-engineer',
      text: 'Which order do you want? @ben',
    },
    {
      kind: 'mention',
      issueTitle: 'Someone else’s bead',
      issueStatus: 'open',
      actor: 'agent-x',
      text: 'cc @ben before I land this',
    },
  ])

  // The stranger bead — created by, assigned to and commented on by agents, with no mention —
  // contributes nothing on either path.
  expect(viaSql.map((item) => item.issueId)).not.toContain(server.strangerId)
  expect(viaCli.map((item) => item.issueId)).not.toContain(embedded.strangerId)

  // Each item's id is keyed to the bead or comment it came from, and an ask carries the
  // deadline the feed orders it by, read back out of the metadata bd stored.
  expect(viaSql.map((item) => item.id)).toContain(`ask:${server.askId}`)
  expect(viaSql.find((item) => item.issueId === server.askId)?.dueAt).toBe(
    ROLLOUT_ASK.default_at,
  )
})

it('picks the right source per project and stamps it on the feed', async () => {
  clearActivitySourceCacheForTest()

  const fromServer = await listActivityItems(server.dir, VIEWER, {
    since: SINCE,
  })
  const fromEmbedded = await listActivityItems(embedded.dir, VIEWER, {
    since: SINCE,
  })

  expect(fromServer.source).toBe('sql')
  expect(fromEmbedded.source).toBe('cli')
  expect(shape(fromServer.items)).toEqual(shape(fromEmbedded.items))
})

it('stops calling a bead "Needs you" once its last ask is answered', async () => {
  // Answered through the app's own mutation, so the feed is proved to follow the same write
  // the issue detail makes — no label to take off, and nothing else to remember.
  await answerAsk(server.askId, ASK_KEY, 'B', 'ben', { cwd: server.dir })

  const feed = await listActivityItems(server.dir, VIEWER, { since: SINCE })
  const onBead = feed.items.filter((item) => item.issueId === server.askId)

  expect(onBead.map((item) => item.kind)).toEqual(['mention'])
  // Answering demotes the bead rather than silencing it: its comment still says "@ben", so it
  // stays in the feed as an ordinary mention.
  expect(feed.items.map((item) => item.id)).not.toContain(`ask:${server.askId}`)
})
