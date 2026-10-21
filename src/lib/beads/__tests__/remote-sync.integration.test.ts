// @vitest-environment node
// ABOUTME: Real Dolt server and file remote prove dirty/staged sync and conflict persistence/resolution.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
  readSyncStatus,
  resolveSyncConflict,
  syncProject,
} from '../remote-sync'

let root: string
let project: string
let database: string
let peer: string
let port: number
let server: ChildProcess
const dolt = (cwd: string, args: string[]) =>
  execFileSync('dolt', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
const query = (sql: string) =>
  dolt(project, [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--no-tls',
    '--use-db',
    'sync_test',
    'sql',
    '-q',
    sql,
  ])
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'pm-beads-sync-test-'))
  project = join(root, 'project')
  database = join(project, '.beads', 'dolt', 'sync_test')
  peer = join(root, 'peer')
  mkdirSync(database, { recursive: true })
  mkdirSync(join(root, 'remote'))
  dolt(database, [
    'init',
    '--name',
    'Sync Test',
    '--email',
    'test@example.invalid',
    '--initial-branch',
    'main',
  ])
  dolt(database, [
    'sql',
    '-q',
    "CREATE TABLE items(id int PRIMARY KEY, value text); INSERT INTO items VALUES(1,'base'); CALL DOLT_ADD('-A'); CALL DOLT_COMMIT('-m','base')",
  ])
  dolt(database, ['remote', 'add', 'origin', `file://${join(root, 'remote')}`])
  dolt(database, ['push', 'origin', 'main'])
  dolt(root, ['clone', `file://${join(root, 'remote')}`, peer])
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  writeFileSync(
    join(project, '.beads', 'metadata.json'),
    JSON.stringify({
      backend: 'dolt',
      dolt_mode: 'server',
      dolt_database: 'sync_test',
    }),
  )
  writeFileSync(join(project, '.beads', 'dolt-server.port'), String(port))
  writeFileSync(
    join(project, '.beads', 'pm-beads.json'),
    JSON.stringify({ sync: { enabled: true } }),
  )
  server = spawn(
    'dolt',
    ['sql-server', '-H', '127.0.0.1', '-P', String(port)],
    { cwd: database, stdio: 'ignore' },
  )
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      query('SELECT 1')
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('Test Dolt server failed to start')
}, 60_000)
afterAll(async () => {
  if (server && server.exitCode === null) {
    server.kill()
    await new Promise((resolve) => server.once('exit', resolve))
  }
  if (root) rmSync(root, { recursive: true, force: true })
})
it('preserves staged and unstaged work and captures a conflicting pull across process restarts', async () => {
  query(
    "INSERT INTO items VALUES(2,'staged'); CALL DOLT_ADD('-A'); INSERT INTO items VALUES(3,'unstaged')",
  )
  expect(await syncProject(project)).toMatchObject({
    conflicts: [],
    lastSuccess: expect.any(String),
  })
  dolt(peer, ['pull', 'origin', 'main'])
  expect(dolt(peer, ['sql', '-q', 'SELECT COUNT(*) FROM items'])).toContain('3')
  query(
    "UPDATE items SET value='ours' WHERE id=1; CALL DOLT_COMMIT('-am','ours')",
  )
  dolt(peer, [
    'sql',
    '-q',
    "UPDATE items SET value='theirs' WHERE id=1; CALL DOLT_COMMIT('-am','theirs')",
  ])
  dolt(peer, ['push', 'origin', 'main'])
  expect(() => query("CALL DOLT_PULL('origin','main')")).toThrow()
  expect(query('SELECT * FROM dolt_conflicts')).not.toContain('items')
  const conflict = await syncProject(project)
  expect(conflict.error).toBeDefined()
  expect(conflict.conflicts).toHaveLength(1)
  expect(conflict.conflicts[0].values).toMatchObject({
    base_value: 'base',
    our_value: 'ours',
    their_value: 'theirs',
  })
  expect(readSyncStatus(project).conflicts).toEqual(conflict.conflicts)
  await expect(
    resolveSyncConflict(project, 'stale-token', 'ours'),
  ).rejects.toThrow('Conflict changed')
  await resolveSyncConflict(project, conflict.conflicts[0].token, 'theirs')
  expect(readSyncStatus(project)).toMatchObject({
    conflicts: [],
    lastSuccess: expect.any(String),
  })
  expect(readSyncStatus(project).error).toBeUndefined()
  expect(query('SELECT * FROM items WHERE id=1')).toContain('theirs')
  dolt(peer, ['pull', 'origin', 'main'])
  query(
    "UPDATE items SET value='keep ours' WHERE id=1; CALL DOLT_COMMIT('-am','ours again')",
  )
  dolt(peer, [
    'sql',
    '-q',
    "UPDATE items SET value='other change' WHERE id=1; CALL DOLT_COMMIT('-am','theirs again')",
  ])
  dolt(peer, ['push', 'origin', 'main'])
  const second = await syncProject(project)
  expect(second.conflicts).toHaveLength(1)
  await resolveSyncConflict(project, second.conflicts[0].token, 'ours')
  expect(readSyncStatus(project).error).toBeUndefined()
  expect(query('SELECT * FROM items WHERE id=1')).toContain('keep ours')
}, 120_000)
