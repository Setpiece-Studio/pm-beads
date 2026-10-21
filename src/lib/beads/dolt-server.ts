// ABOUTME: Guard for server-mode projects that opted out of bd's dolt auto-start: detects
// ABOUTME: dolt.auto-start false in .beads/config.yaml and reports a stopped server.

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { runBdJson } from './cli'
import { hasMiseConfig } from './project-env'

/** Only the fields this guard reads; bd reports more. */
const doltStatusSchema = z.object({ running: z.boolean() })

/** Read `dolt.auto-start` out of a bd config.yaml. bd's config is small and this is the
 * only key the app needs, so it is scanned line by line rather than pulling in a YAML
 * parser: top-level `dolt:` opens the block, and an indented `auto-start:` inside it
 * carries the value. Comments (including the commented-out template bd ships) are
 * stripped first. Returns null when the key is absent or not a boolean. */
export function parseDoltAutoStart(yaml: string): boolean | null {
  let inDoltBlock = false
  for (const rawLine of yaml.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trimEnd()
    if (line.trim() === '') continue
    if (!/^\s/.test(line)) {
      inDoltBlock = /^dolt:\s*$/.test(line)
      continue
    }
    if (!inDoltBlock) continue
    const match = /^\s+auto-start:\s*(\S+)$/.exec(line)
    if (match === null) continue
    if (match[1] === 'false') return false
    if (match[1] === 'true') return true
    return null
  }
  return null
}

/** True when the project told bd not to manage its dolt server — an externally managed
 * or agent-shared server that a developer starts by hand. */
export function isDoltAutoStartDisabled(projectDir: string): boolean {
  let yaml: string
  try {
    yaml = readFileSync(join(projectDir, '.beads', 'config.yaml'), 'utf8')
  } catch {
    return false
  }
  return parseDoltAutoStart(yaml) === false
}

/** How the developer should start this project's server. A mise-configured project needs
 * its env for cloud dolt remotes, so the suggestion carries it. */
export function doltStartCommand(projectDir: string): string {
  return hasMiseConfig(projectDir)
    ? 'mise exec -- bd dolt start'
    : 'bd dolt start'
}

/** The user-facing reason this project can't be read right now, or null when it can.
 *
 * Only projects that disabled auto-start are probed: everywhere else bd starts its own
 * server on demand, and the probe would be a wasted bd call. `bd dolt status` is the one
 * command that reports a stopped server instead of trying to start one. */
export async function stoppedDoltServerError(
  projectDir: string,
): Promise<string | null> {
  if (!isDoltAutoStartDisabled(projectDir)) return null

  let running: boolean
  try {
    const status = doltStatusSchema.parse(
      await runBdJson(['dolt', 'status', '--json'], { cwd: projectDir }),
    )
    running = status.running
  } catch {
    // Auto-start is off and the status probe failed: nothing the app runs can recover
    // the project, so report the same actionable message rather than a bd stack.
    running = false
  }
  if (running) return null

  return `Dolt server for ${basename(projectDir)} is not running. Start it with: ${doltStartCommand(projectDir)}`
}
