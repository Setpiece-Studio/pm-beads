// ABOUTME: Unit tests for per-project env resolution — sidecar/mise precedence, the sidecar
// ABOUTME: schema, command execution and failure fallbacks, and mtime-keyed caching.

import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearProjectEnvCacheForTest,
  envSignature,
  hasMiseConfig,
  resolveEnvSource,
  resolveProjectEnv,
  sidecarFilePath,
} from '../project-env'

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'pm-beads-env-'))
  mkdirSync(join(projectDir, '.beads'))
  clearProjectEnvCacheForTest()
  // The failure paths log one warning each; keep the test output pristine while
  // still asserting the warning happened.
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(projectDir, { recursive: true, force: true })
})

function writeSidecar(value: unknown): void {
  writeFileSync(sidecarFilePath(projectDir), JSON.stringify(value, null, 2))
}

/** A script the env command can run: prints `json` and records one line per run. */
function writeEnvScript(json: string, name = 'env.sh'): void {
  const path = join(projectDir, name)
  writeFileSync(
    path,
    `#!/bin/sh\necho run >> runs.log\nprintf '%s' '${json}'\n`,
  )
  chmodSync(path, 0o755)
}

function runCount(): number {
  try {
    return readFileSync(join(projectDir, 'runs.log'), 'utf8').trim().split('\n')
      .length
  } catch {
    return 0
  }
}

/** Bump a file's mtime past the cached signature deterministically — two writes in
 * the same millisecond can otherwise share an mtime. */
function touchLater(path: string): void {
  const later = new Date(Date.now() + 10_000)
  utimesSync(path, later, later)
}

describe('resolveEnvSource', () => {
  it('reports no source for a project with neither sidecar nor mise config', () => {
    expect(resolveEnvSource(projectDir)).toEqual({
      origin: 'none',
      command: null,
      vars: {},
    })
  })

  it('prefers the sidecar over an existing mise config', () => {
    writeFileSync(join(projectDir, 'mise.toml'), '[env]\nA = "1"\n')
    writeSidecar({ env: { vars: { A: 'from-sidecar' } } })
    expect(resolveEnvSource(projectDir)).toEqual({
      origin: 'sidecar',
      command: null,
      vars: { A: 'from-sidecar' },
    })
  })

  it('auto-detects mise when the sidecar configures no env', () => {
    writeSidecar({ version: 1 })
    writeFileSync(join(projectDir, 'mise.local.toml'), '[env]\nA = "1"\n')
    expect(resolveEnvSource(projectDir)).toEqual({
      origin: 'mise',
      command: 'mise env --json',
      vars: {},
    })
  })

  it.each([
    'mise.toml',
    'mise.local.toml',
    '.mise.toml',
  ])('treats %s as a mise config', (name) => {
    writeFileSync(join(projectDir, name), '[env]\nA = "1"\n')
    expect(hasMiseConfig(projectDir)).toBe(true)
    expect(resolveEnvSource(projectDir).origin).toBe('mise')
  })

  it('ignores a sidecar that does not match the schema', () => {
    writeSidecar({ env: { vars: { A: 42 } } })
    expect(resolveEnvSource(projectDir).origin).toBe('none')
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('ignores a corrupt sidecar', () => {
    writeFileSync(sidecarFilePath(projectDir), '{not json')
    expect(resolveEnvSource(projectDir).origin).toBe('none')
    expect(console.warn).toHaveBeenCalledOnce()
  })
})

describe('resolveProjectEnv', () => {
  it('resolves to an empty env when nothing is configured', async () => {
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({})
  })

  it('returns static sidecar vars without running a command', async () => {
    writeSidecar({ env: { vars: { BEADS_ACTOR: 'sidecar' } } })
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({
      BEADS_ACTOR: 'sidecar',
    })
  })

  it('runs the sidecar command in the project dir and parses its JSON object', async () => {
    writeEnvScript('{"FROM_COMMAND":"yes"}')
    writeSidecar({ env: { command: '/bin/sh env.sh' } })
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({
      FROM_COMMAND: 'yes',
    })
  })

  it('layers static vars over the command output', async () => {
    writeEnvScript('{"A":"from-command","B":"from-command"}')
    writeSidecar({
      env: { command: '/bin/sh env.sh', vars: { B: 'from-vars' } },
    })
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({
      A: 'from-command',
      B: 'from-vars',
    })
  })

  it('resolves to an empty env when the command fails, warning once', async () => {
    writeSidecar({ env: { command: '/bin/sh missing.sh' } })
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({})
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('resolves to an empty env when the command prints non-JSON', async () => {
    writeEnvScript('not json at all')
    writeSidecar({ env: { command: '/bin/sh env.sh' } })
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({})
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('resolves to an empty env when the command prints a non-object', async () => {
    writeEnvScript('[1,2,3]')
    writeSidecar({ env: { command: '/bin/sh env.sh' } })
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({})
    expect(console.warn).toHaveBeenCalledOnce()
  })

  it('resolves to an empty env when a value is not a string', async () => {
    writeEnvScript('{"A":1}')
    writeSidecar({ env: { command: '/bin/sh env.sh' } })
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({})
    expect(console.warn).toHaveBeenCalledOnce()
  })
})

describe('project env caching', () => {
  it('runs the command once for repeated resolutions', async () => {
    writeEnvScript('{"A":"1"}')
    writeSidecar({ env: { command: '/bin/sh env.sh' } })

    await resolveProjectEnv(projectDir)
    await resolveProjectEnv(projectDir)
    await resolveProjectEnv(projectDir)

    expect(runCount()).toBe(1)
  })

  it('dedupes concurrent resolutions of the same project', async () => {
    writeEnvScript('{"A":"1"}')
    writeSidecar({ env: { command: '/bin/sh env.sh' } })

    const results = await Promise.all([
      resolveProjectEnv(projectDir),
      resolveProjectEnv(projectDir),
      resolveProjectEnv(projectDir),
    ])

    expect(results).toEqual([{ A: '1' }, { A: '1' }, { A: '1' }])
    expect(runCount()).toBe(1)
  })

  it('re-resolves when the sidecar changes', async () => {
    writeEnvScript('{"A":"first"}')
    writeSidecar({ env: { command: '/bin/sh env.sh' } })
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({ A: 'first' })

    writeSidecar({ env: { vars: { A: 'second' } } })
    touchLater(sidecarFilePath(projectDir))
    await expect(resolveProjectEnv(projectDir)).resolves.toEqual({
      A: 'second',
    })
  })

  // The mise branch shells out to the real `mise`, so its invalidation is asserted on
  // the cache signature rather than by running it.
  it('changes the cache signature when a mise config appears', () => {
    const before = envSignature(projectDir)
    writeFileSync(join(projectDir, 'mise.toml'), '[env]\nA = "1"\n')
    expect(envSignature(projectDir)).not.toBe(before)
  })

  it('changes the cache signature when a mise config is touched', () => {
    const misePath = join(projectDir, 'mise.local.toml')
    writeFileSync(misePath, '[env]\nA = "1"\n')
    const before = envSignature(projectDir)
    touchLater(misePath)
    expect(envSignature(projectDir)).not.toBe(before)
  })
})
