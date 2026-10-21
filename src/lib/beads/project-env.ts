// ABOUTME: Per-project environment resolution for bd spawns — reads the .beads/pm-beads.json
// ABOUTME: sidecar or auto-detects mise, caches the result by config mtime, never throws.

import { execFile } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'

const execFileAsync = promisify(execFile)

/** Mise config filenames checked, in mise's own precedence order. All of them are
 * loaded by a single `mise env --json`; the list only decides whether to run it. */
const MISE_CONFIG_FILES = [
  'mise.local.toml',
  'mise.toml',
  '.mise.toml',
] as const

const MISE_ENV_COMMAND = 'mise env --json'

/** Wall-clock cap on an env command. It runs before the bd process lock is taken, so a
 * hung one delays only the project it belongs to — but it must still end. */
const ENV_COMMAND_TIMEOUT_MS = 10_000

const sidecarSchema = z.object({
  version: z.number().optional(),
  env: z
    .object({
      /** Argv split on whitespace, run in the project dir; stdout must be a JSON object. */
      command: z.string().min(1).optional(),
      /** Static values, layered over the command's output. */
      vars: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
})

export interface ProjectEnvSource {
  /** Where the configuration came from — 'none' means bd gets the app's env unchanged. */
  origin: 'sidecar' | 'mise' | 'none'
  /** Command to run in the project dir, or null when the source is static. */
  command: string | null
  /** Static values layered over the command's output. */
  vars: Record<string, string>
}

export function sidecarFilePath(projectDir: string): string {
  return join(projectDir, '.beads', 'pm-beads.json')
}

/** True when the project carries a mise config, so `mise exec` / `mise env` apply to it. */
export function hasMiseConfig(projectDir: string): boolean {
  return MISE_CONFIG_FILES.some(
    (name) => mtime(join(projectDir, name)) !== null,
  )
}

/** Where this project's bd env comes from: an explicit sidecar wins, mise is the
 * auto-detected fallback, and a project with neither contributes nothing. */
export function resolveEnvSource(projectDir: string): ProjectEnvSource {
  const sidecar = readSidecar(projectDir)
  const env = sidecar?.env
  if (
    env !== undefined &&
    (env.command !== undefined || env.vars !== undefined)
  ) {
    return {
      origin: 'sidecar',
      command: env.command ?? null,
      vars: env.vars ?? {},
    }
  }
  if (hasMiseConfig(projectDir)) {
    return { origin: 'mise', command: MISE_ENV_COMMAND, vars: {} }
  }
  return { origin: 'none', command: null, vars: {} }
}

interface CacheEntry {
  signature: string
  env: Record<string, string>
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<Record<string, string>>>()

/** The environment bd should inherit when run in `projectDir`, on top of the app's own.
 * Cached per project and re-read only when a config file's mtime changes; failures
 * (bad sidecar, missing or erroring command) resolve to {} so bd still runs. */
export function resolveProjectEnv(
  projectDir: string,
): Promise<Record<string, string>> {
  const signature = envSignature(projectDir)
  const cached = cache.get(projectDir)
  if (cached !== undefined && cached.signature === signature) {
    return Promise.resolve(cached.env)
  }

  const pending = inFlight.get(projectDir)
  if (pending !== undefined) return pending

  const load = loadProjectEnv(projectDir, signature).finally(() => {
    inFlight.delete(projectDir)
  })
  inFlight.set(projectDir, load)
  return load
}

/** Cache key for a project's env: the mtimes of every file that can change the answer.
 * Exported so tests can assert invalidation without shelling out to mise. */
export function envSignature(projectDir: string): string {
  const files = [
    sidecarFilePath(projectDir),
    ...MISE_CONFIG_FILES.map((name) => join(projectDir, name)),
  ]
  return files.map((path) => mtime(path) ?? '-').join('|')
}

export function clearProjectEnvCacheForTest(): void {
  cache.clear()
  inFlight.clear()
}

async function loadProjectEnv(
  projectDir: string,
  signature: string,
): Promise<Record<string, string>> {
  const source = resolveEnvSource(projectDir)
  const fromCommand =
    source.command === null
      ? {}
      : await runEnvCommand(projectDir, source.command)
  const env = { ...fromCommand, ...source.vars }
  // Failures are cached too: re-running a broken command on every bd call would
  // cost the per-call overhead this cache exists to remove. Fixing the config
  // changes an mtime, which invalidates the entry.
  cache.set(projectDir, { signature, env })
  return env
}

/** Run an env command in the project dir and parse its stdout as a JSON string map.
 * Argv is split on whitespace — no shell, so no quoting or expansion. */
async function runEnvCommand(
  projectDir: string,
  command: string,
): Promise<Record<string, string>> {
  const [file, ...args] = command.split(/\s+/).filter((part) => part !== '')
  if (file === undefined) return {}
  try {
    const { stdout } = await execFileAsync(file, args, {
      cwd: projectDir,
      maxBuffer: 4 * 1024 * 1024,
      timeout: ENV_COMMAND_TIMEOUT_MS,
    })
    const parsed = z
      .record(z.string(), z.string())
      .safeParse(JSON.parse(stdout))
    if (!parsed.success) {
      warn(projectDir, `\`${command}\` did not print a JSON object of strings`)
      return {}
    }
    return parsed.data
  } catch (error) {
    warn(projectDir, `\`${command}\` failed: ${message(error)}`)
    return {}
  }
}

function readSidecar(projectDir: string): z.infer<typeof sidecarSchema> | null {
  let raw: string
  try {
    raw = readFileSync(sidecarFilePath(projectDir), 'utf8')
  } catch {
    // Absent is the common case, not a problem worth reporting.
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    warn(projectDir, `${sidecarFilePath(projectDir)} is not valid JSON`)
    return null
  }
  const sidecar = sidecarSchema.safeParse(parsed)
  if (!sidecar.success) {
    warn(
      projectDir,
      `${sidecarFilePath(projectDir)} does not match the pm-beads schema`,
    )
    return null
  }
  return sidecar.data
}

/** Milliseconds-since-epoch as a string, or null when the file is absent. */
function mtime(path: string): string | null {
  try {
    return String(statSync(path).mtimeMs)
  } catch {
    return null
  }
}

function warn(projectDir: string, detail: string): void {
  console.warn(`[pm-beads] project env for ${projectDir}: ${detail}`)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
