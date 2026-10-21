// ABOUTME: Finds and stops the `dolt sql-server` processes the e2e seeds started, matched by
// ABOUTME: working directory so a run only ever kills servers rooted inside its own scan root.

import { execFileSync } from 'node:child_process'
import { sep } from 'node:path'
import process from 'node:process'

export interface DoltServer {
  pid: number
  cwd: string
}

/** Pids of every `dolt sql-server` on the machine, from `ps -axo pid=,command=` output.
 * The command line carries no data directory, so the caller still has to match on cwd. */
export function parseDoltServerPids(psOutput: string): number[] {
  const pids: number[] = []
  for (const line of psOutput.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (match === null) continue
    const [, pid, command] = match
    if (!/(^|\/)dolt\s+sql-server(\s|$)/.test(command)) continue
    pids.push(Number(pid))
  }
  return pids
}

function listDoltServerPids(): number[] {
  try {
    return parseDoltServerPids(
      execFileSync('ps', ['-axo', 'pid=,command='], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    )
  } catch {
    return []
  }
}

/** A process's working directory via lsof, or null when it cannot be read (the process
 * exited, lsof is missing, or it belongs to another user). */
function cwdOf(pid: number): string | null {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return /^n(.+)$/m.exec(output)?.[1] ?? null
  } catch {
    return null
  }
}

export interface SweepDeps {
  listDoltServerPids?: () => number[]
  cwdOf?: (pid: number) => string | null
}

/** Only the dolt servers whose working directory is inside `root` — never the ones serving
 * the developer's own repos, which are running for unrelated reasons. */
export function doltServersUnder(root: string, deps: SweepDeps = {}): DoltServer[] {
  const list = deps.listDoltServerPids ?? listDoltServerPids
  const readCwd = deps.cwdOf ?? cwdOf
  const servers: DoltServer[] = []
  for (const pid of list()) {
    const cwd = readCwd(pid)
    if (cwd === null) continue
    if (cwd !== root && !cwd.startsWith(root.endsWith(sep) ? root : root + sep))
      continue
    servers.push({ pid, cwd })
  }
  return servers
}

/** SIGTERM every dolt server under `root`, escalating to SIGKILL for stragglers. Returns
 * the pids it signalled so teardown can report what it cleaned up. */
export async function stopDoltServersUnder(
  root: string,
  deps: SweepDeps = {},
): Promise<number[]> {
  const servers = doltServersUnder(root, deps)
  if (servers.length === 0) return []

  const pids = servers.map((server) => server.pid)
  for (const pid of pids) signal(pid, 'SIGTERM')

  for (let attempt = 0; attempt < 20 && pids.some(isAlive); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  for (const pid of pids.filter(isAlive)) signal(pid, 'SIGKILL')
  return pids
}

function signal(pid: number, signalName: NodeJS.Signals): void {
  try {
    process.kill(pid, signalName)
  } catch {
    // Already gone — nothing to stop.
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
