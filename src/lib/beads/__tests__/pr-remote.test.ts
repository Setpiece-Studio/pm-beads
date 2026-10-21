// ABOUTME: Tests for resolvePrRef against a real git repo — a bare #N resolves through the
// ABOUTME: project's origin remote, a full url needs no remote, and a missing remote explains itself.

import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolvePrRef } from '../pr-remote'

const execFileAsync = promisify(execFile)

describe('resolvePrRef', () => {
  let dir: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pm-beads-prref-'))
    await execFileAsync('git', ['init', '-q'], { cwd: dir })
    await execFileAsync(
      'git',
      ['remote', 'add', 'origin', 'git@github.com:o/r.git'],
      { cwd: dir },
    )
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('reads the project origin remote to resolve a bare number', async () => {
    await expect(resolvePrRef('#7', dir)).resolves.toBe(
      'https://github.com/o/r/pull/7',
    )
  })

  it('resolves a full url in a directory with no git remote at all', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'pm-beads-prref-bare-'))
    try {
      await expect(
        resolvePrRef('https://github.com/a/b/pull/3', bare),
      ).resolves.toBe('https://github.com/a/b/pull/3')
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it('fails with a readable message when a bare number has no remote', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'pm-beads-prref-none-'))
    try {
      await expect(resolvePrRef('7', bare)).rejects.toThrow(/origin remote/i)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})
