// ABOUTME: Fresh, read-only agent diagnostics; failures are explicitly incomplete, never clean.
import { z } from 'zod'
import { ASK_METADATA_PREFIX, askKeySchema, askValueSchema } from './asks'
import { beadsProjectDir, runBdJson } from './cli'
import { bdOptionsFor } from './projects'
import { readOnlySql } from './read-only-sql'
import { readSyncStatus } from './remote-sync'

export interface CheckDiagnostic {
  code:
    | 'ASK_KEY_INVALID'
    | 'ASK_JSON_INVALID'
    | 'ASK_SCHEMA_INVALID'
    | 'DOLT_CONFLICT'
    | 'CHECK_UNAVAILABLE'
  issueId?: string
  metadataKey?: string
  field?: string
  table?: string
  record?: string
  message: string
}

export function checkAsks(
  issueId: string,
  metadata: Record<string, unknown>,
): CheckDiagnostic[] {
  const diagnostics: CheckDiagnostic[] = []
  for (const [metadataKey, raw] of Object.entries(metadata)) {
    if (!metadataKey.startsWith(ASK_METADATA_PREFIX)) continue
    const context = { issueId, metadataKey }
    if (
      !askKeySchema.safeParse(metadataKey.slice(ASK_METADATA_PREFIX.length))
        .success
    ) {
      diagnostics.push({
        ...context,
        code: 'ASK_KEY_INVALID',
        field: 'key',
        message: 'Invalid ask metadata key',
      })
    }
    let value = raw
    try {
      if (typeof raw === 'string') value = JSON.parse(raw)
    } catch {
      diagnostics.push({
        ...context,
        code: 'ASK_JSON_INVALID',
        field: '$',
        message: 'Ask value is not valid JSON',
      })
      continue
    }
    const parsed = askValueSchema.safeParse(value)
    if (!parsed.success) {
      for (const error of parsed.error.issues) {
        const fields = error.path.length
          ? [error.path.join('.')]
          : error.code === 'unrecognized_keys'
            ? error.keys
            : error.code === 'custom'
              ? ['answer', 'answered_by', 'answered_at']
              : ['$']
        for (const field of fields)
          diagnostics.push({
            ...context,
            code: 'ASK_SCHEMA_INVALID',
            field,
            message: error.message,
          })
      }
    }
  }
  return diagnostics
}

const rowsSchema = z.array(
  z.object({
    id: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullish(),
  }),
)

export async function handleCheck(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const params = url.searchParams
  const project = params.get('project') ?? undefined
  const issueId = params.get('issueId') ?? undefined
  const json = (body: unknown, status: number) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  if (
    [...params.keys()].some(
      (key) =>
        !['project', 'issueId'].includes(key) ||
        params.getAll(key).length !== 1,
    ) ||
    project === '' ||
    issueId === '' ||
    (issueId !== undefined && !/^[\w.-]+$/.test(issueId))
  ) {
    return json({ error: 'Invalid query parameters' }, 400)
  }
  let opts: ReturnType<typeof bdOptionsFor>
  try {
    opts = bdOptionsFor(project)
  } catch (error) {
    return json({ error: String(error) }, 400)
  }
  const issues: CheckDiagnostic[] = []
  const completeness = {
    beads: false,
    databaseConflicts: false,
    pendingConflicts: false,
  }
  let missing = false
  try {
    // Bypass every app snapshot, include closed beads, and prohibit CLI writes/autopush.
    const rows = rowsSchema.parse(
      await runBdJson(
        [
          'list',
          '--all',
          '--include-infra',
          '--limit',
          '0',
          '--json',
          '--readonly',
          '--sandbox',
        ],
        opts,
      ),
    )
    missing = issueId !== undefined && !rows.some((row) => row.id === issueId)
    for (const row of rows)
      if (issueId === undefined || row.id === issueId)
        issues.push(...checkAsks(row.id, row.metadata ?? {}))
    completeness.beads = true
  } catch (error) {
    issues.push({
      code: 'CHECK_UNAVAILABLE',
      table: 'issues',
      message: String(error),
    })
  }
  const inspectedAt = new Date().toISOString()
  let pendingSnapshotAt: string | undefined
  try {
    const pending = readSyncStatus(opts.cwd ?? beadsProjectDir())
    pendingSnapshotAt = pending.inspectedAt
    for (const conflict of pending.conflicts) {
      const bead =
        conflict.table === 'issues'
          ? (conflict.values.our_id ??
            conflict.values.their_id ??
            conflict.values.base_id)
          : (conflict.values.our_issue_id ??
            conflict.values.their_issue_id ??
            conflict.values.base_issue_id)
      if (issueId && typeof bead === 'string' && bead !== issueId) continue
      issues.push({
        code: 'DOLT_CONFLICT',
        table: conflict.table,
        record: conflict.record,
        message: 'Pending sync conflict (persisted snapshot)',
        ...(typeof bead === 'string' ? { issueId: bead } : {}),
      })
    }
    completeness.pendingConflicts = true
  } catch (error) {
    issues.push({
      code: 'CHECK_UNAVAILABLE',
      table: 'sync_snapshot',
      message: String(error),
    })
  }
  try {
    const conflicts = z
      .array(z.object({ table: z.string(), num_conflicts: z.coerce.number() }))
      .parse(await readOnlySql('SELECT * FROM dolt_conflicts', opts))
    for (const conflict of conflicts) {
      if (conflict.num_conflicts <= 0) continue
      const table = `dolt_conflicts_${conflict.table}`.replaceAll('`', '``')
      const rows = z
        .array(z.record(z.string(), z.unknown()))
        .parse(await readOnlySql(`SELECT * FROM \`${table}\``, opts))
      for (const row of rows) {
        const bead =
          conflict.table === 'issues'
            ? (row.our_id ?? row.their_id ?? row.base_id)
            : (row.our_issue_id ?? row.their_issue_id ?? row.base_issue_id)
        if (issueId && typeof bead === 'string' && bead !== issueId) continue
        issues.push({
          code: 'DOLT_CONFLICT',
          table: conflict.table,
          record: String(row.dolt_conflict_id ?? 'unknown'),
          ...(typeof bead === 'string' ? { issueId: bead } : {}),
          message: 'Unresolved database conflict (live inspection)',
        })
      }
    }
    completeness.databaseConflicts = true
  } catch (error) {
    issues.push({
      code: 'CHECK_UNAVAILABLE',
      table: 'dolt_conflicts',
      message: String(error),
    })
  }
  const complete = Object.values(completeness).every(Boolean)
  return json(
    {
      version: 1,
      ok: complete && !missing && issues.length === 0,
      checkedAt: new Date().toISOString(),
      issues,
      completeness: { complete, ...completeness },
      conflictSnapshot: {
        source: completeness.databaseConflicts ? 'live' : 'unavailable',
        inspectedAt,
        pendingSource: 'cached',
        pendingSnapshotAt,
      },
      ...(missing ? { error: 'Bead not found' } : {}),
    },
    !complete ? 503 : missing ? 404 : 200,
  )
}
