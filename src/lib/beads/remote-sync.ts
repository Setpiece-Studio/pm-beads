// ABOUTME: Opt-in SQL pull/push with durable conflict snapshots, bounded cycles and shared write locking.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { invalidateBdCache } from './cache'
import { withProcessLock } from './cli'
import { resolveProjectEnv } from './project-env'
import { readSidecarObject } from './sidecar'

const exec = promisify(execFile)
type Row = Record<string, z.infer<ReturnType<typeof z.json>>>
export interface SyncConflict {
  table: string
  record: string
  token: string
  values: Row
}
export interface SyncStatus {
  lastAttempt?: string
  lastSuccess?: string
  error?: string
  inspectedAt?: string
  conflicts: SyncConflict[]
}
export const syncConfigSchema = z.object({
  enabled: z.boolean().default(false),
  remote: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
})
export function readSyncConfig(dir: string) {
  return syncConfigSchema.parse(readSidecarObject(dir)?.sync ?? {})
}
function statusPath(dir: string) {
  return join(dir, '.beads', 'pm-beads-sync.json')
}
export function readSyncStatus(dir: string): SyncStatus {
  try {
    return z
      .object({
        lastAttempt: z.string().optional(),
        lastSuccess: z.string().optional(),
        error: z.string().optional(),
        inspectedAt: z.string().optional(),
        conflicts: z.array(
          z.object({
            table: z.string(),
            record: z.string(),
            token: z.string(),
            values: z.record(z.string(), z.json()),
          }),
        ),
      })
      .parse(JSON.parse(readFileSync(statusPath(dir), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { conflicts: [] }
    throw new Error(
      'Sync status is unreadable; repair or restore the snapshot before syncing',
    )
  }
}
function saveStatus(dir: string, status: SyncStatus) {
  const path = statusPath(dir)
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}
export const sqlValue = (value: unknown): string =>
  value === null || value === undefined
    ? 'NULL'
    : typeof value === 'number'
      ? String(value)
      : typeof value === 'boolean'
        ? String(Number(value))
        : value === ''
          ? "''"
          : `CONVERT(0x${Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('hex')} USING utf8mb4)`
const identifier = (value: string) => `\`${value.replaceAll('`', '``')}\``

/** Dolt emits one JSON object per result set, and {} for an empty result. */
export function parseSqlRows(stdout: string): Row[] {
  const results = stdout
    .trim()
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
  const last = results.at(-1)
  if (last && !('rows' in last) && Object.keys(last).length === 0) return []
  return z.array(z.record(z.string(), z.json())).parse(last?.rows)
}

async function sqlRunner(dir: string, deadline = Date.now() + 240_000) {
  let beads = join(dir, '.beads')
  try {
    beads = resolve(beads, readFileSync(join(beads, 'redirect'), 'utf8').trim())
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const metadata = z
    .object({
      dolt_database: z.string().min(1),
      dolt_mode: z.literal('server'),
    })
    .parse(JSON.parse(readFileSync(join(beads, 'metadata.json'), 'utf8')))
  const port = Number(
    readFileSync(join(beads, 'dolt-server.port'), 'utf8').trim(),
  )
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid Dolt server port')
  const env = { ...process.env, ...(await resolveProjectEnv(dir)) }
  return async (query: string): Promise<Row[]> => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('Sync cycle timed out')
    const { stdout } = await exec(
      'dolt',
      [
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--no-tls',
        '--use-db',
        metadata.dolt_database,
        'sql',
        '-r',
        'json',
        '-q',
        query,
      ],
      {
        cwd: dir,
        env,
        timeout: Math.min(60_000, remaining),
        maxBuffer: 32 * 1024 * 1024,
      },
    )
    return parseSqlRows(stdout)
  }
}
type Sql = Awaited<ReturnType<typeof sqlRunner>>
const isMerging = (row: Row) =>
  [true, 1, '1', 'true'].includes(row.is_merging as string | number | boolean)
function token(table: string, values: Row) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        table,
        Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest('hex')
}
async function inspectConflicts(sql: Sql): Promise<SyncConflict[]> {
  const tables = await sql('SELECT * FROM dolt_conflicts')
  const conflicts: SyncConflict[] = []
  for (const table of tables) {
    if (typeof table.table !== 'string')
      throw new Error('Unknown Dolt conflict table shape')
    for (const values of await sql(
      `SELECT * FROM ${identifier(`dolt_conflicts_${table.table}`)}`,
    )) {
      if (typeof values.dolt_conflict_id !== 'string')
        throw new Error('This Dolt version does not expose conflict IDs')
      conflicts.push({
        table: table.table,
        record: values.dolt_conflict_id,
        token: token(table.table, values),
        values,
      })
    }
  }
  return conflicts
}

// Only byte-identical sides are provably duplicate without domain-specific event identity.
export function duplicateConflict(values: Row): boolean {
  const ours = Object.keys(values).filter((key) => key.startsWith('our_'))
  return (
    ours.length > 1 &&
    ours.every(
      (key) =>
        JSON.stringify(values[key]) ===
        JSON.stringify(values[`their_${key.slice(4)}`]),
    )
  )
}
const running = new Set<string>()
export async function syncProject(dir: string): Promise<SyncStatus> {
  if (running.has(dir)) return readSyncStatus(dir)
  running.add(dir)
  try {
    return await withProcessLock(async () => {
      const status = readSyncStatus(dir)
      status.lastAttempt = new Date().toISOString()
      delete status.error
      saveStatus(dir, status)
      let sql: Sql | undefined
      try {
        const config = readSyncConfig(dir)
        if (!config.enabled)
          throw new Error('Remote sync is disabled for this project')
        sql = await sqlRunner(dir)
        const remotes = await sql('SELECT * FROM dolt_remotes')
        const remote =
          config.remote ??
          remotes.find((row) => row.name === 'origin')?.name ??
          remotes[0]?.name
        if (
          typeof remote !== 'string' ||
          !remotes.some((row) => row.name === remote)
        )
          throw new Error('No configured Dolt remote')
        const branchRows = await sql('SELECT active_branch() AS branch')
        const branch = config.branch ?? branchRows[0]?.branch
        if (typeof branch !== 'string' || branch !== branchRows[0]?.branch)
          throw new Error('Sync branch must match the active database branch')
        status.conflicts = await inspectConflicts(sql)
        if (status.conflicts.length)
          throw new Error('Resolve database conflicts before syncing')
        // Commit staged and unstaged data together; never reset or discard a working set.
        const pendingMerge = await sql('SELECT * FROM dolt_merge_status')
        if (
          (await sql('SELECT * FROM dolt_status')).length ||
          pendingMerge.some(isMerging)
        )
          await sql(
            "CALL DOLT_ADD('-A'); CALL DOLT_COMMIT('-m', 'pm-beads sync: preserve pending writes')",
          )
        for (let attempt = 1; attempt <= 3; attempt++) {
          // Without this session variable a conflicting pull rolls back, hiding all rows.
          await sql(
            `SET dolt_allow_commit_conflicts=1; CALL DOLT_PULL(${sqlValue(remote)}, ${sqlValue(branch)})`,
          )
          status.conflicts = await inspectConflicts(sql)
          for (const conflict of status.conflicts)
            if (duplicateConflict(conflict.values))
              await sql(
                `DELETE FROM ${identifier(`dolt_conflicts_${conflict.table}`)} WHERE dolt_conflict_id=${sqlValue(conflict.record)}`,
              )
          status.conflicts = await inspectConflicts(sql)
          if (status.conflicts.length)
            throw new Error('Pull has unresolved conflicts')
          const merge = await sql('SELECT * FROM dolt_merge_status')
          if (merge.some(isMerging))
            await sql(
              "CALL DOLT_ADD('-A'); CALL DOLT_COMMIT('-m', 'pm-beads sync: resolved merge')",
            )
          try {
            await sql(
              `CALL DOLT_PUSH(${sqlValue(remote)}, ${sqlValue(branch)})`,
            )
            status.lastSuccess = new Date().toISOString()
            break
          } catch (error) {
            if (
              attempt === 3 ||
              !/non.fast.forward|fetch first|rejected|behind/i.test(
                String(error),
              )
            )
              throw error
          }
        }
      } catch (error) {
        status.error = error instanceof Error ? error.message : String(error)
        if (sql) {
          try {
            status.conflicts = await inspectConflicts(sql)
          } catch {
            /* Keep the prior snapshot; its timestamp stays old. */
          }
        }
      } finally {
        if (sql) {
          try {
            status.conflicts = await inspectConflicts(sql)
            status.inspectedAt = new Date().toISOString()
          } catch {
            /* Preserve pending conflicts when inspection is unavailable. */
          }
        }
        saveStatus(dir, status)
        invalidateBdCache({ cwd: dir })
      }
      return status
    })
  } finally {
    running.delete(dir)
  }
}

export async function resolveSyncConflict(
  dir: string,
  expected: string,
  side: 'ours' | 'theirs',
): Promise<void> {
  await withProcessLock(async () => {
    const sql = await sqlRunner(dir)
    const conflicts = await inspectConflicts(sql)
    const conflict = conflicts.find((row) => row.token === expected)
    if (!conflict) throw new Error('Conflict changed; refresh before resolving')
    const values = conflict.values
    const columns = Object.keys(values)
      .filter((key) => key.startsWith('our_') && key !== 'our_diff_type')
      .map((key) => key.slice(4))
    const keys = await sql(
      `SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${sqlValue(conflict.table)} AND CONSTRAINT_NAME='PRIMARY'`,
    )
    if (!keys.length)
      throw new Error('Cannot safely resolve a table without a primary key')
    const where = keys
      .map(
        (key) =>
          `${identifier(String(key.name))} <=> ${sqlValue(values[`our_${key.name}`] ?? values[`their_${key.name}`])}`,
      )
      .join(' AND ')
    const current = await sql(
      `SELECT * FROM ${identifier(conflict.table)} WHERE ${where}`,
    )
    const deleted = values.our_diff_type === 'removed'
    if (
      deleted
        ? current.length !== 0
        : current.length !== 1 ||
          columns.some(
            (column) =>
              JSON.stringify(current[0][column]) !==
              JSON.stringify(values[`our_${column}`]),
          )
    )
      throw new Error(
        'Local row changed since the conflict; refresh and resolve manually',
      )
    const statements: string[] = [
      'SET dolt_allow_commit_conflicts=1',
      'START TRANSACTION',
    ]
    if (side === 'theirs') {
      if (values.their_diff_type === 'removed')
        statements.push(
          `DELETE FROM ${identifier(conflict.table)} WHERE ${where}`,
        )
      else if (deleted)
        statements.push(
          `INSERT INTO ${identifier(conflict.table)} (${columns.map(identifier).join(',')}) VALUES (${columns.map((column) => sqlValue(values[`their_${column}`])).join(',')})`,
        )
      else
        statements.push(
          `UPDATE ${identifier(conflict.table)} SET ${columns.map((column) => `${identifier(column)}=${sqlValue(values[`their_${column}`])}`).join(',')} WHERE ${where}`,
        )
    }
    statements.push(
      `DELETE FROM ${identifier(`dolt_conflicts_${conflict.table}`)} WHERE dolt_conflict_id=${sqlValue(conflict.record)}`,
      'COMMIT',
    )
    await sql(statements.join('; '))
    const status = readSyncStatus(dir)
    status.conflicts = await inspectConflicts(sql)
    status.inspectedAt = new Date().toISOString()
    saveStatus(dir, status)
    invalidateBdCache({ cwd: dir })
  })
  // Resolutions only leave the machine via the normal pull/push cycle.
  await syncProject(dir)
}
