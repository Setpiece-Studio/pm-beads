// @vitest-environment node
// ABOUTME: Fault-injected SQL transport exercises bounded retries, overlap prevention and error reporting.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { exec } = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: exec }))
vi.mock('node:util', () => ({ promisify: (fn: unknown) => fn }))

import { syncProject } from '../remote-sync'

let dir: string
let pushes: number
let pulls: number
let fail: 'none' | 'remote' | 'auth' | 'timeout' | 'race'
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sync-fault-test-'))
  mkdirSync(join(dir, '.beads'))
  writeFileSync(
    join(dir, '.beads', 'metadata.json'),
    JSON.stringify({ dolt_database: 'test', dolt_mode: 'server' }),
  )
  writeFileSync(join(dir, '.beads', 'dolt-server.port'), '12345')
  writeFileSync(
    join(dir, '.beads', 'pm-beads.json'),
    JSON.stringify({ sync: { enabled: true } }),
  )
  pushes = 0
  pulls = 0
  fail = 'none'
  exec
    .mockReset()
    .mockImplementation(
      async (
        _command: string,
        args: string[],
        options: { timeout: number },
      ) => {
        expect(options.timeout).toBeGreaterThan(0)
        expect(options.timeout).toBeLessThanOrEqual(60_000)
        const query = args.at(-1) ?? ''
        let rows: object[] = []
        if (query.includes('dolt_remotes'))
          rows = fail === 'remote' ? [] : [{ name: 'origin' }]
        if (query.includes('active_branch')) rows = [{ branch: 'main' }]
        if (query.includes('DOLT_PULL')) {
          pulls++
          if (fail === 'auth') throw new Error('authentication failed')
          if (fail === 'timeout') throw new Error('SQL subprocess timed out')
        }
        if (query.includes('DOLT_PUSH')) {
          pushes++
          if (fail === 'race' && pushes < 3) throw new Error('non-fast-forward')
        }
        return { stdout: JSON.stringify({ rows }) }
      },
    )
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))
it.each([
  'remote',
  'auth',
  'timeout',
] as const)('reports %s failure without success or push', async (mode) => {
  fail = mode
  const result = await syncProject(dir)
  expect(result.error).toBeDefined()
  expect(result.lastSuccess).toBeUndefined()
  expect(pushes).toBe(0)
})
it('retries a non-fast-forward push with a fresh pull, up to three attempts', async () => {
  fail = 'race'
  expect((await syncProject(dir)).lastSuccess).toBeDefined()
  expect(pushes).toBe(3)
  expect(pulls).toBe(3)
})
it('does not overlap concurrent cycles for one project', async () => {
  await Promise.all([syncProject(dir), syncProject(dir), syncProject(dir)])
  expect(pushes).toBe(1)
})
