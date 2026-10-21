// ABOUTME: Integration test for the PR-history backfill against a real throwaway bd project with
// ABOUTME: a `gh` stand-in: scan proposes, apply closes/comments, and skips persist in the sidecar.

import { execFile } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// bd writes wait on the embedded dolt exclusive lock; a too-small timeout kills a
// test mid-write and the orphaned bd process cascades lock failures into later tests.
vi.setConfig({ testTimeout: 60_000 })

import { runBd } from '../cli'
import type { BackfillProposal } from '../pr-backfill'
import {
  applyPrBackfill,
  scanPrBackfill,
  skipPrBackfill,
} from '../pr-backfill-run'
import { readBackfillConfig } from '../pr-backfill-store'
import { clearProjectEnvCacheForTest } from '../project-env'
import { getIssue, listIssueComments } from '../queries'

const execFileAsync = promisify(execFile)

const REPO = 'backfill-owner/backfill-repo'
const prUrl = (n: number) => `https://github.com/${REPO}/pull/${n}`

/** The PR the pre-linked bead already points at — a different one from what the scan finds. */
const EXISTING_PR = 9

let dir: string
let shimDir: string
let originalPath: string | undefined

let highId: string
let mediumId: string
let epicId: string
let linkedId: string
let closedId: string
let untouchedId: string

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

/** A `gh` on PATH answering only this repo's history query, with PR bodies that reference the
 * ids bd just minted. Written after the beads exist, since their ids are what it must quote. */
function writeGhShim(prs: unknown[]): void {
  const path = join(shimDir, 'gh')
  writeFileSync(
    path,
    `#!/bin/sh
case "$*" in
  *"pr list"*"${REPO}"*) printf '%s\\n' '${JSON.stringify(prs)}' ;;
  *) echo "gh (backfill shim): unexpected call: $*" >&2; exit 1 ;;
esac
`,
  )
  chmodSync(path, 0o755)
}

/** The scan reads the repo off `git remote get-url origin`, so the throwaway project needs one.
 * No commit is ever made here — only the remote is read. */
async function initGitOrigin(cwd: string): Promise<void> {
  await execFileAsync('git', ['init', '--quiet'], { cwd })
  await execFileAsync(
    'git',
    ['remote', 'add', 'origin', `https://github.com/${REPO}.git`],
    { cwd },
  )
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pm-beads-backfill-itest-'))
  shimDir = mkdtempSync(join(tmpdir(), 'pm-beads-backfill-gh-'))

  await runBd(['init', '--prefix', 'bkf'], {
    cwd: dir,
    env: { BD_NON_INTERACTIVE: '1' },
  })
  await initGitOrigin(dir)

  highId = await createIssue({ title: 'Closed by a Closes line', type: 'task' })
  mediumId = await createIssue({ title: 'Named in a PR title', type: 'task' })
  epicId = await createIssue({ title: 'Epic with a merged PR', type: 'epic' })
  linkedId = await createIssue({
    title: 'Already linked to an older PR',
    type: 'task',
    prNumber: EXISTING_PR,
  })
  closedId = await createIssue({ title: 'Already closed', type: 'task' })
  await runBd(['close', closedId, '--reason', 'closed by hand'], { cwd: dir })
  untouchedId = await createIssue({ title: 'Never mentioned', type: 'task' })

  writeGhShim([
    {
      number: 201,
      url: prUrl(201),
      title: 'Ship the thing',
      // The foreign-prefix mention must not become a proposal of its own.
      body: `Closes ${highId}\n\nMirrors sc-14 in the other tracker.`,
      headRefName: 'feat/ship-the-thing',
      mergedAt: '2026-08-20T12:00:00Z',
    },
    {
      number: 202,
      url: prUrl(202),
      title: 'Epic groundwork',
      body: `Fixes ${epicId}`,
      headRefName: 'feat/epic-groundwork',
      mergedAt: '2026-08-19T12:00:00Z',
    },
    {
      number: 203,
      url: prUrl(203),
      title: 'Second attempt',
      body: `Resolves ${linkedId}`,
      headRefName: 'feat/second-attempt',
      mergedAt: '2026-08-18T12:00:00Z',
    },
    {
      number: 204,
      url: prUrl(204),
      title: 'Old work',
      body: `Closes ${closedId}`,
      headRefName: 'feat/old-work',
      mergedAt: '2026-08-17T12:00:00Z',
    },
    {
      number: 205,
      url: prUrl(205),
      title: `${mediumId}: named in the title only`,
      body: 'No closing keyword here.',
      headRefName: 'feat/title-only',
      mergedAt: '2026-08-16T12:00:00Z',
    },
  ])

  originalPath = process.env.PATH
  // Prepended, not replaced: bd and git still have to resolve off the inherited PATH.
  process.env.PATH = `${shimDir}:${originalPath ?? ''}`
}, 120_000)

afterAll(() => {
  process.env.PATH = originalPath
  clearProjectEnvCacheForTest()
  if (dir) rmSync(dir, { recursive: true, force: true })
  if (shimDir) rmSync(shimDir, { recursive: true, force: true })
})

/** The text of every comment on an issue, with its author — the backfill signs as `pm-beads`. */
async function commentsOf(id: string) {
  return (await listIssueComments(id, { cwd: dir })).map((comment) => ({
    author: comment.author,
    text: comment.text,
  }))
}

function byId(
  proposals: BackfillProposal[],
  id: string,
): BackfillProposal | undefined {
  return proposals.find((proposal) => proposal.id === id)
}

describe('the PR-history backfill against a real bd project', () => {
  let proposals: BackfillProposal[]

  it('scans merged PRs into proposals and writes nothing', async () => {
    const result = await scanPrBackfill({ projectDir: dir, daysBack: 3650 })
    proposals = result.proposals

    expect(result.warnings).toEqual([])
    expect(result.prefix).toBe('bkf-')
    expect(result.repos).toEqual([REPO])
    expect(result.scannedPrs).toBe(5)

    // High-confidence closing line: link it and close it.
    expect(byId(proposals, highId)).toMatchObject({
      confidence: 'high',
      prNumber: 201,
      actions: ['set-pr-url', 'close'],
    })

    // An epic never gets auto-closed, however confident the match.
    expect(byId(proposals, epicId)).toMatchObject({
      confidence: 'high',
      prNumber: 202,
      actions: ['set-pr-url', 'comment-only'],
    })

    // A bead already pointing somewhere else is an UPDATE, not a close.
    expect(byId(proposals, linkedId)).toMatchObject({
      confidence: 'high',
      prNumber: 203,
      actions: ['set-pr-url', 'comment-only'],
      previousPrUrl: prUrl(EXISTING_PR),
    })

    // Title-only match: proposed, but at the tier the UI leaves unchecked.
    expect(byId(proposals, mediumId)).toMatchObject({
      confidence: 'medium',
      prNumber: 205,
    })

    // Already closed, and never mentioned: neither is proposed.
    expect(byId(proposals, closedId)).toBeUndefined()
    expect(byId(proposals, untouchedId)).toBeUndefined()

    // Strongest first: every high-confidence row precedes the medium one.
    expect(proposals.map((p) => p.confidence)).toEqual([
      'high',
      'high',
      'high',
      'medium',
    ])

    // Nothing was written by the scan itself.
    expect(await commentsOf(highId)).toEqual([])
    expect((await getIssue(highId, { cwd: dir })).status).toBe('open')
  })

  it('applies only the approved rows: links, comments, and closes', async () => {
    const approved = [highId, epicId, linkedId].map((id) => {
      const proposal = byId(proposals, id)
      if (proposal === undefined) throw new Error(`no proposal for ${id}`)
      return proposal
    })

    const result = await applyPrBackfill({
      projectDir: dir,
      proposals: approved,
    })
    expect(result.warnings).toEqual([])
    expect(result.applied.map((o) => [o.id, o.kind])).toEqual([
      [highId, 'close'],
      [epicId, 'comment-only'],
      [linkedId, 'comment-only'],
    ])

    // The plain bead: linked, commented (signed pm-beads), and closed on the PR's reason.
    const high = await getIssue(highId, { cwd: dir })
    expect(high.status).toBe('closed')
    expect(high.close_reason).toBe('PR #201 merged')
    expect(high.metadata?.pr_url).toBe(prUrl(201))
    expect(await commentsOf(highId)).toEqual([
      {
        author: 'pm-beads',
        text: `Closed: PR #201 merged ${prUrl(201)} — backfilled from PR history (high confidence)`,
      },
    ])

    // The epic: linked and commented, still open.
    const epic = await getIssue(epicId, { cwd: dir })
    expect(epic.status).toBe('open')
    expect(epic.metadata?.pr_url).toBe(prUrl(202))
    expect((await commentsOf(epicId))[0].text).toContain(
      'not auto-closed (epic / open ask)',
    )

    // The re-pointed bead: new link, a comment naming the old one, still open.
    const linked = await getIssue(linkedId, { cwd: dir })
    expect(linked.status).toBe('open')
    expect(linked.metadata?.pr_url).toBe(prUrl(203))
    expect((await commentsOf(linkedId))[0].text).toContain(
      `pr_url updated from ${prUrl(EXISTING_PR)}`,
    )

    // The row that was NOT approved is untouched.
    const medium = await getIssue(mediumId, { cwd: dir })
    expect(medium.status).toBe('open')
    expect(medium.metadata?.pr_url).toBeUndefined()
    expect(await commentsOf(mediumId)).toEqual([])
  })

  it('drops applied beads from a re-scan without proposing them again', async () => {
    const { proposals: after } = await scanPrBackfill({
      projectDir: dir,
      daysBack: 3650,
    })

    // The closed bead is gone; the two comment-only beads now point at the very PR that
    // claims them, so there is nothing left to propose for them either.
    expect(after.map((p) => p.id)).toEqual([mediumId])
  })

  it('remembers a skipped bead in the sidecar, so it never comes back', async () => {
    await skipPrBackfill(dir, [mediumId])
    expect(readBackfillConfig(dir).skipped).toEqual([mediumId])

    const { proposals: after } = await scanPrBackfill({
      projectDir: dir,
      daysBack: 3650,
    })
    expect(after).toEqual([])
  })
})
