// ABOUTME: Read SQL in server or embedded projects without syncing or changing database mode.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import {
  type BdOptions,
  beadsProjectDir,
  runBdJson,
  withProcessLock,
} from './cli'
import { resolveProjectEnv } from './project-env'
import { parseSqlRows } from './remote-sync'

const exec = promisify(execFile)

export async function readOnlySql(
  query: string,
  opts: BdOptions,
): Promise<unknown> {
  if (!/^SELECT\b/i.test(query))
    throw new Error('Only SELECT queries are allowed')
  try {
    return await runBdJson(
      ['sql', query, '--json', '--readonly', '--sandbox'],
      opts,
    )
  } catch (error) {
    if (
      !String(error).includes("'bd sql' is not yet supported in embedded mode")
    )
      throw error
    const project = opts.cwd ?? beadsProjectDir()
    const metadata = z
      .object({ dolt_database: z.string().regex(/^[\w.-]+$/) })
      .parse(
        JSON.parse(
          readFileSync(join(project, '.beads', 'metadata.json'), 'utf8'),
        ),
      )
    const env = {
      ...process.env,
      ...(await resolveProjectEnv(project)),
      ...opts.env,
    }
    return withProcessLock(async () => {
      const { stdout } = await exec(
        'dolt',
        ['sql', '-r', 'json', '-q', query],
        {
          cwd: join(project, '.beads', 'embeddeddolt', metadata.dolt_database),
          env,
          timeout: 30_000,
          maxBuffer: 32 * 1024 * 1024,
        },
      )
      return parseSqlRows(stdout)
    })
  }
}
