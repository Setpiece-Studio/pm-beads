// ABOUTME: Shared e2e helpers — the throwaway beads project dir path, a serialized bd
// ABOUTME: runner with lock-retry, and the seed manifest written by global-setup.

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { resolveCheckoutRoot, resolvePort, resolveScanRoot } from './isolation'

const execFileAsync = promisify(execFile)

/** The checkout this run belongs to. Every isolated value below hangs off it, so two
 * worktrees running the suite at once never share a port or a seed directory. */
export const E2E_CHECKOUT_ROOT = resolveCheckoutRoot()

// Deterministic paths so playwright.config.ts can hand them to the webServer env
// before globalSetup runs. globalSetup recreates the scan root, globalTeardown
// removes it. The scan root doubles as PM_BEADS_SCAN_DIRS for the project picker;
// it holds the default project plus a second one to exercise project switching.
// The root is per-checkout (or E2E_SCAN_ROOT); the project names inside it are fixed,
// because the UI shows them and the specs assert on them.
export const E2E_SCAN_ROOT = resolveScanRoot(process.env, E2E_CHECKOUT_ROOT)
export const E2E_PROJECT_NAME = 'pm-beads-e2e-project'
export const E2E_SECOND_PROJECT_NAME = 'pm-beads-e2e-second'
export const E2E_LEGACY_PROJECT_NAME = 'pm-beads-e2e-legacy'
export const E2E_WIDE_PROJECT_NAME = 'pm-beads-e2e-wide'
export const E2E_STOPPED_SERVER_PROJECT_NAME = 'pm-beads-e2e-stopped'

export const E2E_PROJECT_DIR = join(E2E_SCAN_ROOT, E2E_PROJECT_NAME)
export const E2E_SECOND_PROJECT_DIR = join(E2E_SCAN_ROOT, E2E_SECOND_PROJECT_NAME)
/** A pre-Dolt (Jan-2026) beads workspace: .beads/metadata.json names a SQLite db and a
 * JSONL export, with no dolt database on disk. bd fails on it with "no beads database
 * found", so discovery must skip it and a hand-typed ?project= must fail politely. */
export const E2E_LEGACY_PROJECT_DIR = join(E2E_SCAN_ROOT, E2E_LEGACY_PROJECT_NAME)
/** A project seeded purely for issues-table column widths: one issue with a long title, four
 * labels, and a long epic name. It lives apart from the default project so the layout fixtures
 * never perturb the group counts every other spec asserts. */
export const E2E_WIDE_PROJECT_DIR = join(E2E_SCAN_ROOT, E2E_WIDE_PROJECT_NAME)

/** The long-title issue's fixtures, shared by global-setup and the layout spec. */
export const WIDE_TITLE =
  'Rework the export pipeline so governed themes survive a round trip through the renderer'
export const WIDE_EPIC_NAME =
  'Reporting platform consolidation and governed theme rollout'
/** Declared in sorted order so the spec's expectations hold whether bd returns the labels
 * in insertion order or alphabetically. */
export const WIDE_LABELS = [
  'area:renderer',
  'good-first-issue',
  'needs-design',
  'perf',
]
/** A server-mode project that opted out of bd's dolt auto-start (`dolt.auto-start: false`)
 * with its server stopped: the app must refuse to touch it and say how to start it. */
export const E2E_STOPPED_SERVER_PROJECT_DIR = join(
  E2E_SCAN_ROOT,
  E2E_STOPPED_SERVER_PROJECT_NAME,
)

/** Directory holding the `gh` stand-in the PR-link spec relies on. Prepended to the dev
 * server's PATH so getPrState shells to canned payloads instead of GitHub. */
export const E2E_GH_SHIM_DIR = join(import.meta.dirname, 'gh-shim')

/** The GitHub repo the seeded project's `origin` points at. The PR-history backfill reads the
 * repo to scan off `git remote get-url origin`, so the seeded project needs a remote — the same
 * owner/repo the gh shim's canned `pr view` payloads use. */
export const E2E_ORIGIN_REPO = 'e2e-owner/e2e-repo'

/** Where the backfill spec writes the merged-PR history the gh shim serves. It cannot be canned
 * in the shim itself: the payload quotes bead ids bd mints at run time. */
export const E2E_PR_HISTORY_FILE = join(E2E_PROJECT_DIR, 'gh-pr-history.json')

export const E2E_PORT = resolvePort(process.env, E2E_CHECKOUT_ROOT)
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`

const SEED_FILE = join(E2E_PROJECT_DIR, 'seed.json')

export interface SeedManifest {
  epicId: string
  alphaId: string
  betaId: string
  gammaId: string
  deltaId: string
  /** Open epic with no children — must still appear in the projects view (with 0/0 progress). */
  lonelyEpicId: string
  /** Closed epic — hidden in the projects view by default, revealed via the status filter. */
  closedEpicId: string
  /** Child epic of E2E Epic — nests under it in the hierarchy view. */
  nestedEpicId: string
}

export function readSeed(): SeedManifest {
  return JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedManifest
}

export function seedFilePath(): string {
  return SEED_FILE
}

/** Run bd in the throwaway project dir (or an explicit cwd), retrying when the embedded
 * dolt exclusive lock is held by the app's own bd process (reads from the UI under test). */
export async function runBd(
  args: string[],
  { attempts = 10, cwd = E2E_PROJECT_DIR }: { attempts?: number; cwd?: string } = {},
): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { stdout } = await execFileAsync('bd', args, {
        cwd,
        env: { ...process.env, BD_NON_INTERACTIVE: '1' },
        maxBuffer: 32 * 1024 * 1024,
      })
      return stdout
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt < attempts && /lock/i.test(message)) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      throw error
    }
  }
}

export async function runBdJson(
  args: string[],
  options: { attempts?: number; cwd?: string } = {},
): Promise<unknown> {
  return JSON.parse((await runBd(args, options)).trim())
}

export interface SendMessageInput {
  subject: string
  body: string
  /** Recipient — the message bead's assignee. */
  to: string
  /** Sender — bd stamps created_by from --actor. */
  from: string
  /** Message this one answers, chained with the built-in `replies-to` dependency. */
  replyTo?: string
  /** Issue the conversation is about, wired with a `relates-to` dependency. */
  issueId?: string
  /** Further issues the message relates to, each its own `relates-to` dependency — the shape a
   * coordinator's brief has when it names several beads. bd does not preserve the order they
   * are given in, so specs must not assert on it. */
  issueIds?: string[]
}

/** Create a message wisp in the throwaway project, returning its id. Messages are
 * infrastructure beads, so they never show up in the issue specs' data. */
export async function sendMessage(input: SendMessageInput): Promise<string> {
  const args = [
    'create',
    input.subject,
    '--type',
    'message',
    '--description',
    input.body,
    '--assignee',
    input.to,
    '--actor',
    input.from,
    '--json',
  ]
  if (input.replyTo !== undefined)
    args.push('--deps', `replies-to:${input.replyTo}`)
  for (const issueId of [
    ...(input.issueId === undefined ? [] : [input.issueId]),
    ...(input.issueIds ?? []),
  ]) {
    args.push('--deps', `relates-to:${issueId}`)
  }
  const created = (await runBdJson(args)) as { id?: string; error?: string }
  if (created.error !== undefined)
    throw new Error(`bd create failed: ${created.error}`)
  if (created.id === undefined) throw new Error('bd create returned no id')
  return created.id
}

/** Every message wisp in the throwaway project, read and unread. Plain `bd list` hides
 * infrastructure beads, so this needs --include-infra. */
export async function listMessages(): Promise<Record<string, unknown>[]> {
  return (await runBdJson([
    'list',
    '--json',
    '--include-infra',
    '--type',
    'message',
    '--all',
    '--limit',
    '0',
  ])) as Record<string, unknown>[]
}

/** bd show --json returns a single-element array; unwrap it. */
export async function bdShow(id: string): Promise<Record<string, unknown>> {
  const result = (await runBdJson(['show', id, '--json'])) as Record<
    string,
    unknown
  >[]
  return result[0]
}
