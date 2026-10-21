// ABOUTME: Beads project selection helpers — the .beads safety guard for caller-supplied
// ABOUTME: project dirs, scan-dir parsing, and on-disk discovery of beads projects.

import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import type { BdOptions } from './cli'

export interface BeadsProject {
  /** Absolute (real) path to the project directory. */
  path: string
  /** Display name — the directory basename. */
  name: string
  /** True for the env-default project (PM_BEADS_PROJECT_DIR / cwd). */
  isDefault: boolean
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Where a Dolt-backed .beads keeps (or points at) its database. `bd init` writes
 * embeddeddolt/, `bd init --server` writes dolt/, and a git worktree gets a
 * `redirect` file holding the relative path to the main checkout's .beads/. */
const DOLT_DATABASE_MARKERS = ['embeddeddolt', 'dolt', 'redirect'] as const

/** Why `dir` cannot be opened as a beads project, or null when it can. Wording is
 * user-facing: it lands in the project-error panel via assertBeadsProjectDir. */
function beadsProjectProblem(dir: string): string | null {
  const beadsDir = join(dir, '.beads')
  if (!isDirectory(beadsDir)) return 'no .beads directory'

  let metadata: unknown
  try {
    metadata = JSON.parse(readFileSync(join(beadsDir, 'metadata.json'), 'utf8'))
  } catch {
    return '.beads/metadata.json is missing or unreadable'
  }
  const backend =
    typeof metadata === 'object' && metadata !== null
      ? (metadata as { backend?: unknown }).backend
      : undefined
  if (backend !== 'dolt') {
    return 'legacy pre-Dolt workspace — .beads/metadata.json has no Dolt backend'
  }

  const hasDatabase = DOLT_DATABASE_MARKERS.some((marker) =>
    existsSync(join(beadsDir, marker)),
  )
  if (!hasDatabase) {
    return 'no Dolt database in .beads (expected embeddeddolt/, dolt/, or a redirect file)'
  }
  return null
}

/** True when `dir` is a beads project bd can actually open: a Dolt-backed .beads in
 * either mode (embedded or server) with its database present. Legacy pre-Dolt
 * workspaces and half-initialized .beads dirs are not projects — bd fails on them
 * with "no beads database found", so discovery must skip them. */
export function isDoltBeadsProject(dir: string): boolean {
  return beadsProjectProblem(dir) === null
}

/** Guard for caller-supplied project dirs (a hand-typed `?project=` URL): the dir must
 * be a Dolt-backed beads project, otherwise bd would run somewhere unintended or fail
 * deep inside a loader with an opaque "Command failed" message. */
export function assertBeadsProjectDir(dir: string): void {
  const problem = beadsProjectProblem(dir)
  if (problem !== null) {
    throw new Error(`Not a Dolt-backed beads project: ${dir} (${problem})`)
  }
}

/** Translate an optional caller-supplied projectDir into BdOptions, applying
 * the .beads guard. Undefined means "use the env default" — no guard needed. */
export function bdOptionsFor(projectDir: string | undefined): BdOptions {
  if (projectDir === undefined) return {}
  assertBeadsProjectDir(projectDir)
  return { cwd: projectDir }
}

/** Parse PM_BEADS_SCAN_DIRS (colon-separated, ~-expandable). */
export function parseScanDirs(raw: string | undefined, home: string): string[] {
  const value = raw ?? '~/Developer:~/developer'
  return value
    .split(':')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) =>
      entry === '~' || entry.startsWith('~/')
        ? join(home, entry.slice(1))
        : entry,
    )
}

function safeRealpath(dir: string): string | null {
  try {
    return realpathSync(dir)
  } catch {
    return null
  }
}

/** Filesystem identity (device + inode). realpath is not enough on macOS:
 * it preserves the caller's casing, so /Users/x/Developer and /Users/x/developer
 * stay distinct strings while being the same directory on case-insensitive APFS. */
function fileIdentity(dir: string): string | null {
  try {
    const stat = statSync(dir)
    return `${stat.dev}:${stat.ino}`
  } catch {
    return null
  }
}

function subdirectories(dir: string): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== 'node_modules',
    )
    .map((entry) => join(dir, entry.name))
}

/** Discover beads projects on disk: scan each root at depth <=2 for directories with a
 * Dolt-backed .beads/ (legacy and half-initialized ones are skipped silently — they are
 * ordinary repos, not errors), dedupe by filesystem identity (Developer/developer may be
 * the same dir on case-insensitive APFS), and always include the default first. */
export function discoverProjects(
  scanDirs: string[],
  defaultDir: string,
): BeadsProject[] {
  const defaultReal = safeRealpath(defaultDir) ?? defaultDir
  const defaultId = fileIdentity(defaultReal)
  const found = new Map<string, BeadsProject>()

  const seenRoots = new Set<string>()
  for (const scanDir of scanDirs) {
    const rootReal = safeRealpath(scanDir)
    if (rootReal === null || !existsSync(rootReal)) continue
    const rootId = fileIdentity(rootReal)
    if (rootId === null || seenRoots.has(rootId)) continue
    seenRoots.add(rootId)

    const depth1 = subdirectories(rootReal)
    const candidates = [rootReal, ...depth1, ...depth1.flatMap(subdirectories)]
    for (const candidate of candidates) {
      if (!isDoltBeadsProject(candidate)) continue
      const real = safeRealpath(candidate)
      if (real === null) continue
      const id = fileIdentity(real)
      if (id === null || found.has(id) || id === defaultId) continue
      found.set(id, { path: real, name: basename(real), isDefault: false })
    }
  }

  const discovered = [...found.values()].sort((a, b) =>
    a.name === b.name
      ? a.path.localeCompare(b.path)
      : a.name.localeCompare(b.name),
  )
  return [
    { path: defaultReal, name: basename(defaultReal), isDefault: true },
    ...discovered,
  ]
}
