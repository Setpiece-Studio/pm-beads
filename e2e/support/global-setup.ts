// ABOUTME: Playwright globalSetup — creates a throwaway beads project in a temp dir (bd init +
// ABOUTME: epic + children + labels + a closed child + a blocks dep + childless/closed epics),
// ABOUTME: plus a second project, a wide-content project, and a legacy pre-Dolt .beads dir.

import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import {
  E2E_CHECKOUT_ROOT,
  E2E_LEGACY_PROJECT_DIR,
  E2E_ORIGIN_REPO,
  E2E_PORT,
  E2E_PROJECT_DIR,
  E2E_SCAN_ROOT,
  E2E_SECOND_PROJECT_DIR,
  E2E_WIDE_PROJECT_DIR,
  E2E_STOPPED_SERVER_PROJECT_DIR,
  runBd,
  runBdJson,
  seedFilePath,
  WIDE_EPIC_NAME,
  WIDE_LABELS,
  WIDE_TITLE,
} from './bd'
import { acquireScanRootLock } from './lock'

const execFileAsync = promisify(execFile)

/** Give the seeded project a GitHub `origin`, which is how the PR-history backfill decides
 * which repo to read merged pull requests from. Nothing is ever committed here — only the
 * remote url is read — and the whole repo dies with the scan root at teardown. */
async function addOriginRemote(cwd: string): Promise<void> {
  await execFileAsync('git', ['init', '--quiet'], { cwd })
  await execFileAsync(
    'git',
    ['remote', 'add', 'origin', `https://github.com/${E2E_ORIGIN_REPO}.git`],
    { cwd },
  )
}

/** Hand-write a pre-Dolt .beads layout: bd never creates one now, and `bd init` in this
 * dir would create a working project instead of the broken one under test. */
function writeLegacyBeadsDir(dir: string): void {
  const beads = join(dir, '.beads')
  mkdirSync(beads, { recursive: true })
  writeFileSync(
    join(beads, 'metadata.json'),
    `${JSON.stringify({ database: 'beads.db', jsonl_export: 'issues.jsonl' }, null, 2)}\n`,
  )
  writeFileSync(join(beads, 'issues.jsonl'), '')
}

/** A server-mode project that manages its own dolt server: `dolt.auto-start: false` in
 * config.yaml, server stopped. bd refuses to start one here, so the app must recognize
 * the state instead of failing on every read. */
async function writeStoppedServerProject(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  await runBd(['init', '--server', '--prefix', 'stp'], { cwd: dir })
  appendFileSync(
    join(dir, '.beads', 'config.yaml'),
    '\ndolt:\n  auto-start: false\n',
  )
  await runBd(['dolt', 'stop'], { cwd: dir })
}

async function createIssue(input: {
  title: string
  type: string
  priority: number
  description?: string
  cwd?: string
}): Promise<string> {
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
  const created = (await runBdJson(args, { cwd: input.cwd })) as { id: string }
  return created.id
}

/** A project whose one issue has a long title, a full label set, and a long epic name — the
 * shape that used to collapse the issues table's title column to nothing. */
async function seedWideProject(): Promise<void> {
  const cwd = E2E_WIDE_PROJECT_DIR
  await runBd(['init', '--prefix', 'wide'], { cwd })
  const epicId = await createIssue({
    title: WIDE_EPIC_NAME,
    type: 'epic',
    priority: 1,
    cwd,
  })
  const issueId = await createIssue({
    title: WIDE_TITLE,
    type: 'task',
    priority: 1,
    cwd,
  })
  await runBd(['dep', 'add', issueId, epicId, '--type', 'parent-child'], { cwd })
  for (const label of WIDE_LABELS) {
    await runBd(['label', 'add', issueId, label], { cwd })
  }
}

export default async function globalSetup(): Promise<void> {
  // Claim the scan root before wiping it. e2e/support/preflight.ts already refused to start
  // the dev server on a busy port or into a locked scan root (webServer runs before
  // globalSetup); this is the atomic claim that makes two same-checkout runs impossible.
  acquireScanRootLock(E2E_SCAN_ROOT, {
    pid: process.pid,
    checkout: E2E_CHECKOUT_ROOT,
    port: E2E_PORT,
  })

  rmSync(E2E_SCAN_ROOT, { recursive: true, force: true })
  mkdirSync(E2E_PROJECT_DIR, { recursive: true })
  mkdirSync(E2E_SECOND_PROJECT_DIR, { recursive: true })
  mkdirSync(E2E_WIDE_PROJECT_DIR, { recursive: true })
  await runBd(['init', '--prefix', 'e2e'])
  // After bd init, never before: `bd init` auto-commits its collateral to a git repo it finds.
  await addOriginRemote(E2E_PROJECT_DIR)

  // Second project for the project picker: discovery finds it under the scan
  // root, and switching to it must show its (distinct) issues.
  await runBd(['init', '--prefix', 'sec'], { cwd: E2E_SECOND_PROJECT_DIR })
  await runBd(
    ['create', 'Second project task', '--type', 'task', '--priority', '1'],
    { cwd: E2E_SECOND_PROJECT_DIR },
  )

  await seedWideProject()

  // A legacy pre-Dolt workspace in the same scan root: the picker must not list it, and
  // navigating to it by URL must fail with the friendly panel, not an app crash.
  writeLegacyBeadsDir(E2E_LEGACY_PROJECT_DIR)

  await writeStoppedServerProject(E2E_STOPPED_SERVER_PROJECT_DIR)

  const epicId = await createIssue({
    title: 'E2E Epic',
    type: 'epic',
    priority: 1,
  })
  const alphaId = await createIssue({
    title: 'Alpha task',
    type: 'task',
    priority: 1,
    description: 'first seeded child',
  })
  const betaId = await createIssue({
    title: 'Beta bug',
    type: 'bug',
    priority: 2,
  })
  const gammaId = await createIssue({
    title: 'Gamma chore',
    type: 'chore',
    priority: 3,
  })
  // The description names Beta by id: that mention is what the markdown autolinker turns
  // into a bead chip, so the detail body has a chip to click through.
  const deltaId = await createIssue({
    title: 'Delta feature',
    type: 'feature',
    priority: 2,
    description: `standalone issue without a project, blocked by ${betaId}`,
  })
  // An open epic with NO children: bd epic status omits it, so it exercises the projects
  // view's complete-set source (it must still appear, with 0/0 progress).
  const lonelyEpicId = await createIssue({
    title: 'Lonely Epic',
    type: 'epic',
    priority: 2,
  })
  // A closed epic: hidden by default in the projects view, revealed via the status filter.
  const closedEpicId = await createIssue({
    title: 'Done Epic',
    type: 'epic',
    priority: 2,
  })
  // A child epic of E2E Epic: in the hierarchy view it nests under E2E Epic, exercising
  // epic-to-epic nesting (absent from the flat list view).
  const nestedEpicId = await createIssue({
    title: 'Nested Epic',
    type: 'epic',
    priority: 2,
  })

  for (const childId of [alphaId, betaId, gammaId]) {
    await runBd(['dep', 'add', childId, epicId, '--type', 'parent-child'])
  }
  await runBd(['close', closedEpicId, '--reason', 'seeded as a finished project'])
  // Beta blocks Alpha: alpha depends on beta with type blocks.
  await runBd(['dep', 'add', alphaId, betaId, '--type', 'blocks'])
  // Nested Epic is a child of E2E Epic, so the hierarchy nests it under E2E Epic.
  await runBd(['dep', 'add', nestedEpicId, epicId, '--type', 'parent-child'])

  await runBd(['label', 'add', alphaId, 'frontend'])
  await runBd(['label', 'add', betaId, 'backend'])
  await runBd(['update', alphaId, '--status', 'in_progress'])
  await runBd(['close', gammaId, '--reason', 'seeded as done'])

  writeFileSync(
    seedFilePath(),
    JSON.stringify(
      {
        epicId,
        alphaId,
        betaId,
        gammaId,
        deltaId,
        lonelyEpicId,
        closedEpicId,
        nestedEpicId,
      },
      null,
      2,
    ),
  )
}
