// ABOUTME: Tests the notifier's hand-editable persona schema and append-only delivery ledger.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  readNotifierConfig,
  recordDeliveredActivity,
  replacePersonas,
} from '../notifier-store'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pm-beads-notifier-store-'))
  mkdirSync(join(dir, '.beads'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('notifier sidecar config', () => {
  it('validates personas and reads aliases plus the ledger', () => {
    writeFileSync(
      join(dir, '.beads', 'pm-beads.json'),
      JSON.stringify({
        personas: { 'data-engineer': { tmux: 'daryl', aliases: ['Daryl'] } },
        notifier: { deliveredActivityIds: ['comment:c1'] },
      }),
    )
    expect(readNotifierConfig(dir)).toEqual({
      personas: { 'data-engineer': { tmux: 'daryl', aliases: ['Daryl'] } },
      deliveredActivityIds: ['comment:c1'],
    })
  })

  it('treats a malformed block as disabled without discarding other keys', async () => {
    writeFileSync(
      join(dir, '.beads', 'pm-beads.json'),
      JSON.stringify({
        env: { vars: { A: 'b' } },
        personas: { bad: null },
      }),
    )
    expect(readNotifierConfig(dir).personas).toEqual({})
    await recordDeliveredActivity(dir, 'comment:c2')
    const sidecar = JSON.parse(
      readFileSync(join(dir, '.beads', 'pm-beads.json'), 'utf8'),
    )
    expect(sidecar.env).toEqual({ vars: { A: 'b' } })
    expect(sidecar.notifier.deliveredActivityIds).toEqual(['comment:c2'])
  })

  it('replaces editable personas while preserving env and the delivery ledger', async () => {
    writeFileSync(
      join(dir, '.beads', 'pm-beads.json'),
      JSON.stringify({
        env: { vars: { A: 'b' } },
        personas: { old: { tmux: 'old-session' } },
        notifier: { deliveredActivityIds: ['comment:c1'] },
      }),
    )

    await replacePersonas(dir, {
      'data-engineer': { tmux: 'daryl', aliases: ['Daryl'] },
    })

    expect(
      JSON.parse(readFileSync(join(dir, '.beads', 'pm-beads.json'), 'utf8')),
    ).toEqual({
      env: { vars: { A: 'b' } },
      personas: {
        'data-engineer': { tmux: 'daryl', aliases: ['Daryl'] },
      },
      notifier: { deliveredActivityIds: ['comment:c1'] },
    })
  })

  it('rejects invalid editable personas before touching the sidecar', async () => {
    writeFileSync(
      join(dir, '.beads', 'pm-beads.json'),
      JSON.stringify({ personas: { safe: { tmux: 'safe-session' } } }),
    )
    await expect(
      replacePersonas(dir, { '': { tmux: 'broken' } }),
    ).rejects.toThrow()
    expect(readNotifierConfig(dir).personas).toEqual({
      safe: { tmux: 'safe-session' },
    })
  })

  it('keeps mention-only personas that have aliases but no tmux route', () => {
    writeFileSync(
      join(dir, '.beads', 'pm-beads.json'),
      JSON.stringify({
        personas: {
          cpo: { aliases: ['CPO'] },
          routed: { tmux: 'daryl' },
          broken: null,
        },
      }),
    )
    expect(readNotifierConfig(dir).personas).toEqual({
      cpo: { aliases: ['CPO'] },
      routed: { tmux: 'daryl' },
    })
  })
})
