// ABOUTME: Integration test that the per-project env reaches the real bd process — a sidecar
// ABOUTME: sets BEADS_ACTOR and bd stamps it as created_by on issues the app creates.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

// bd writes wait on the embedded dolt exclusive lock; a too-small timeout kills a
// test mid-write and the orphaned bd process cascades lock failures into later tests.
vi.setConfig({ testTimeout: 60_000 })

import { runBd } from '../cli'
import { createIssue } from '../mutations'
import { clearProjectEnvCacheForTest, sidecarFilePath } from '../project-env'
import { getIssue } from '../queries'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pm-beads-envtest-'))
  await runBd(['init', '--prefix', 'env'], {
    cwd: dir,
    env: { BD_NON_INTERACTIVE: '1' },
  })
}, 60_000)

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeSidecar(value: unknown): void {
  writeFileSync(sidecarFilePath(dir), JSON.stringify(value, null, 2))
  // bd init ran before the sidecar existed; drop the cached "no env" answer rather
  // than relying on the mtime of a file that did not exist when it was cached.
  clearProjectEnvCacheForTest()
}

it('injects sidecar vars into bd, which stamps them on the issue', async () => {
  writeSidecar({ env: { vars: { BEADS_ACTOR: 'pm-beads-static-var' } } })

  const created = await createIssue(
    { title: 'Created under a sidecar env', type: 'task', priority: 2 },
    { cwd: dir },
  )
  const issue = await getIssue(created.id, { cwd: dir })

  expect(issue?.created_by).toBe('pm-beads-static-var')
})

it('injects vars produced by the sidecar env command', async () => {
  const script = join(dir, 'env.sh')
  writeFileSync(
    script,
    '#!/bin/sh\nprintf \'{"BEADS_ACTOR":"pm-beads-command-var"}\'\n',
  )
  chmodSync(script, 0o755)
  writeSidecar({ env: { command: '/bin/sh env.sh' } })

  const created = await createIssue(
    { title: 'Created under a sidecar command env', type: 'task', priority: 2 },
    { cwd: dir },
  )
  const issue = await getIssue(created.id, { cwd: dir })

  expect(issue?.created_by).toBe('pm-beads-command-var')
})

it('leaves bd on the app env when no sidecar configures one', async () => {
  rmSync(sidecarFilePath(dir))
  clearProjectEnvCacheForTest()
  vi.stubEnv('BEADS_ACTOR', 'pm-beads-app-env')

  const created = await createIssue(
    { title: 'Created without a project env', type: 'task', priority: 2 },
    { cwd: dir },
  )
  const issue = await getIssue(created.id, { cwd: dir })

  expect(issue?.created_by).toBe('pm-beads-app-env')
  vi.unstubAllEnvs()
})
