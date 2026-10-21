// ABOUTME: Integration test for the merged-PR sweep against a real throwaway bd project, with a
// ABOUTME: `gh` stand-in on PATH: one bead closes, an epic and an open ask only get a comment.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// bd writes wait on the embedded dolt exclusive lock; a too-small timeout kills a
// test mid-write and the orphaned bd process cascades lock failures into later tests.
vi.setConfig({ testTimeout: 60_000 })

import { askMetadataKey, serializeAsk } from '../asks'
import { runBd } from '../cli'
import { sweepMergedPrs } from '../pr-sweep-run'
import { readSweepConfig } from '../pr-sweep-store'
import { clearProjectEnvCacheForTest } from '../project-env'
import { getIssue, listIssueComments } from '../queries'

const OPEN_ASK = serializeAsk({
  kind: 'decision',
  q: 'Renderer or exporter first?',
  by: 'coordinator',
  at: '2026-08-19T10:00:00.000Z',
})

const REPO = 'sweep-owner/sweep-repo'
const prUrl = (n: number) => `https://github.com/${REPO}/pull/${n}`

/** PRs the gh shim reports as merged. 105 is deliberately absent — its bead must survive. */
const MERGED = [101, 102, 103, 104]

let dir: string
let shimDir: string
let originalPath: string | undefined

let plainId: string
let epicId: string
let askId: string
let closedId: string
let unmergedId: string
let noPrId: string

/** A `gh` on PATH that answers only `pr list` for the one repo under test, with canned merged
 * PRs. Anything else exits non-zero, which the sweep must degrade into a warning. */
function writeGhShim(dir: string): void {
  const payload = JSON.stringify(
    MERGED.map((number) => ({
      number,
      url: prUrl(number),
      mergedAt: '2026-08-26T09:00:00Z',
    })),
  )
  const path = join(dir, 'gh')
  writeFileSync(
    path,
    `#!/bin/sh
case "$*" in
  *"pr list"*"${REPO}"*) printf '%s\\n' '${payload}' ;;
  *) echo "gh (sweep shim): unexpected call: $*" >&2; exit 1 ;;
esac
`,
  )
  chmodSync(path, 0o755)
}

async function createIssue(input: {
  title: string
  type: string
  prNumber?: number
}): Promise<string> {
  const stdout = await runBd(
    ['create', input.title, '--type', input.type, '--priority', '1', '--json'],
    { cwd: dir },
  )
  const { id } = JSON.parse(stdout) as { id: string }
  if (input.prNumber !== undefined) {
    await runBd(
      ['update', id, '--set-metadata', `pr_url=${prUrl(input.prNumber)}`],
      { cwd: dir },
    )
  }
  return id
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pm-beads-sweep-itest-'))
  shimDir = mkdtempSync(join(tmpdir(), 'pm-beads-sweep-gh-'))
  writeGhShim(shimDir)
  originalPath = process.env.PATH
  // Prepended, not replaced: bd itself still has to resolve off the inherited PATH.
  process.env.PATH = `${shimDir}:${originalPath ?? ''}`

  await runBd(['init', '--prefix', 'swp'], {
    cwd: dir,
    env: { BD_NON_INTERACTIVE: '1' },
  })

  plainId = await createIssue({
    title: 'Plain task with a merged PR',
    type: 'task',
    prNumber: 101,
  })
  epicId = await createIssue({
    title: 'Epic with a merged PR',
    type: 'epic',
    prNumber: 102,
  })
  askId = await createIssue({
    title: 'Task with an open ask and a merged PR',
    type: 'task',
    prNumber: 103,
  })
  await runBd(
    [
      'update',
      askId,
      '--set-metadata',
      `${askMetadataKey('rollout')}=${OPEN_ASK}`,
      '--actor',
      'coordinator',
    ],
    { cwd: dir },
  )
  closedId = await createIssue({
    title: 'Already closed task with a merged PR',
    type: 'task',
    prNumber: 104,
  })
  await runBd(['close', closedId, '--reason', 'closed by hand'], { cwd: dir })
  unmergedId = await createIssue({
    title: 'Task whose PR is still open',
    type: 'task',
    prNumber: 105,
  })
  noPrId = await createIssue({ title: 'Task with no PR', type: 'task' })
}, 120_000)

afterAll(() => {
  process.env.PATH = originalPath
  clearProjectEnvCacheForTest()
  if (dir) rmSync(dir, { recursive: true, force: true })
  if (shimDir) rmSync(shimDir, { recursive: true, force: true })
})

/** The text of every comment on an issue, with its author — the sweep signs as `pm-beads`. */
async function commentsOf(id: string) {
  return (await listIssueComments(id, { cwd: dir })).map((comment) => ({
    author: comment.author,
    text: comment.text,
  }))
}

describe('sweepMergedPrs against a real bd project', () => {
  it('dry run reports the plan and writes nothing', async () => {
    const result = await sweepMergedPrs({ projectDir: dir, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.closed.map((o) => o.id)).toEqual([plainId])
    expect(result.commented.map((o) => o.id).sort()).toEqual(
      [epicId, askId].sort(),
    )

    // Nothing was touched: no comments, no status change, no sidecar stamp.
    expect(await commentsOf(plainId)).toEqual([])
    expect((await getIssue(plainId, { cwd: dir })).status).toBe('open')
    expect(readSweepConfig(dir).lastRunAt).toBeUndefined()
  })

  it('closes the plain bead, comments on the epic and the human bead, leaves the rest alone', async () => {
    const result = await sweepMergedPrs({ projectDir: dir })

    expect(result.warnings).toEqual([])
    expect(result.dryRun).toBe(false)

    // The plain bead: commented (signed pm-beads) and closed with the PR as the reason.
    expect(result.closed).toEqual([
      {
        id: plainId,
        title: 'Plain task with a merged PR',
        prUrl: prUrl(101),
        prNumber: 101,
      },
    ])
    expect(await commentsOf(plainId)).toEqual([
      {
        author: 'pm-beads',
        text: `Closed: PR #101 merged ${prUrl(101)}`,
      },
    ])
    const plain = await getIssue(plainId, { cwd: dir })
    expect(plain.status).toBe('closed')
    expect(plain.close_reason).toBe('PR #101 merged')

    // The epic and the bead with an open ask: comment only, still open.
    expect(result.commented.map((o) => o.id).sort()).toEqual(
      [epicId, askId].sort(),
    )
    for (const [id, number] of [
      [epicId, 102],
      [askId, 103],
    ] as const) {
      expect(await commentsOf(id)).toEqual([
        {
          author: 'pm-beads',
          text: `PR #${number} merged ${prUrl(number)} — not auto-closed (epic / open ask)`,
        },
      ])
      expect((await getIssue(id, { cwd: dir })).status).toBe('open')
    }

    // The already-closed bead keeps its own close reason and gets no comment.
    expect(result.skipped).toContainEqual({
      id: closedId,
      prUrl: prUrl(104),
      reason: 'closed',
    })
    expect(await commentsOf(closedId)).toEqual([])
    expect((await getIssue(closedId, { cwd: dir })).close_reason).toBe(
      'closed by hand',
    )

    // The bead whose PR has not merged is untouched.
    expect(result.skipped).toContainEqual({
      id: unmergedId,
      prUrl: prUrl(105),
      reason: 'not-merged',
    })
    expect((await getIssue(unmergedId, { cwd: dir })).status).toBe('open')

    // A bead with no pr_url is never a candidate at all.
    const seen = [
      ...result.closed.map((o) => o.id),
      ...result.commented.map((o) => o.id),
      ...result.skipped.map((s) => s.id),
    ]
    expect(seen).not.toContain(noPrId)

    // A clean run stamps the sidecar, so the next sweep searches from here.
    expect(readSweepConfig(dir).lastRunAt).toBe(result.ranAt)
    expect(new Date(result.since).getTime()).toBeLessThan(
      new Date(result.ranAt).getTime(),
    )
  })

  it('is idempotent: a second sweep finds nothing left to close', async () => {
    const result = await sweepMergedPrs({ projectDir: dir })

    expect(result.closed).toEqual([])
    // The epic and the human bead still match, so they are commented on again — the sweep
    // deliberately keeps nagging rather than silently forgetting a bead a person must handle.
    expect(result.commented.map((o) => o.id).sort()).toEqual(
      [epicId, askId].sort(),
    )
    expect(result.skipped).toContainEqual({
      id: plainId,
      prUrl: prUrl(101),
      reason: 'closed',
    })
  })
})
