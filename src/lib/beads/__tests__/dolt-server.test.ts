// ABOUTME: Unit tests for the stopped-dolt-server guard — reading dolt.auto-start out of
// ABOUTME: .beads/config.yaml and choosing the start command the error message suggests.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  doltStartCommand,
  isDoltAutoStartDisabled,
  parseDoltAutoStart,
  stoppedDoltServerError,
} from '../dolt-server'
import { clearProjectEnvCacheForTest } from '../project-env'

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'pm-beads-dolt-'))
  mkdirSync(join(projectDir, '.beads'))
  clearProjectEnvCacheForTest()
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

function writeConfig(yaml: string): void {
  writeFileSync(join(projectDir, '.beads', 'config.yaml'), yaml)
}

describe('parseDoltAutoStart', () => {
  it('reads a false value from the dolt block', () => {
    expect(parseDoltAutoStart('dolt:\n  auto-start: false\n')).toBe(false)
  })

  it('reads a true value from the dolt block', () => {
    expect(parseDoltAutoStart('dolt:\n  auto-start: true\n')).toBe(true)
  })

  it('returns null when the key is absent', () => {
    expect(parseDoltAutoStart('dolt:\n  port: 3306\n')).toBeNull()
  })

  it('ignores the commented-out template bd ships', () => {
    const template = [
      '# Dolt server management (auto-started by bd)',
      '# dolt:',
      '#   auto-start: false',
      '',
      'export:',
      '  auto: false',
    ].join('\n')
    expect(parseDoltAutoStart(template)).toBeNull()
  })

  it('ignores an auto-start key outside the dolt block', () => {
    expect(parseDoltAutoStart('backup:\n  auto-start: false\n')).toBeNull()
  })

  it('returns null for a non-boolean value', () => {
    expect(parseDoltAutoStart('dolt:\n  auto-start: maybe\n')).toBeNull()
  })
})

describe('isDoltAutoStartDisabled', () => {
  it('is false when there is no config file', () => {
    expect(isDoltAutoStartDisabled(projectDir)).toBe(false)
  })

  it('is false when auto-start is left at its default', () => {
    writeConfig('# nothing configured\n')
    expect(isDoltAutoStartDisabled(projectDir)).toBe(false)
  })

  it('is true when the project disables auto-start', () => {
    writeConfig('dolt:\n  auto-start: false\n')
    expect(isDoltAutoStartDisabled(projectDir)).toBe(true)
  })
})

describe('doltStartCommand', () => {
  it('suggests a bare bd command for a project without mise', () => {
    expect(doltStartCommand(projectDir)).toBe('bd dolt start')
  })

  it('suggests running through mise when the project has a mise config', () => {
    writeFileSync(join(projectDir, 'mise.toml'), '[env]\nA = "1"\n')
    expect(doltStartCommand(projectDir)).toBe('mise exec -- bd dolt start')
  })
})

describe('stoppedDoltServerError', () => {
  it('is null — without asking bd — when auto-start is enabled', async () => {
    // No bd call: a project bd may start itself must not pay for a status probe.
    await expect(stoppedDoltServerError(projectDir)).resolves.toBeNull()
  })
})
