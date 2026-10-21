// ABOUTME: Unit tests for the teardown sweep that finds dolt sql-servers the seeds started —
// ABOUTME: parsing ps output and keeping only the servers rooted inside a given scan root.

import { describe, expect, it } from 'vitest'
import { doltServersUnder, parseDoltServerPids } from './dolt-servers'

const PS = [
  ' 19477 /opt/homebrew/bin/dolt sql-server -H 127.0.0.1 -P 62459 --loglevel=warning',
  '40328 /Users/dev/.local/share/mise/installs/dolt/bin/dolt sql-server -H 127.0.0.1 -P 62747',
  ' 51234 /usr/bin/vim dolt-sql-server-notes.md',
  ' 51235 bun run test:e2e',
  '',
].join('\n')

describe('parseDoltServerPids', () => {
  it('picks out only the dolt sql-server processes', () => {
    expect(parseDoltServerPids(PS)).toEqual([19477, 40328])
  })

  it('tolerates empty ps output', () => {
    expect(parseDoltServerPids('')).toEqual([])
  })
})

describe('doltServersUnder', () => {
  const cwds = new Map([
    [19477, '/Users/dev/pm-beads/.beads/dolt'],
    [40328, '/var/tmp/pm-beads-e2e-deadbeef/pm-beads-e2e-stopped/.beads/dolt'],
    [51236, '/var/tmp/pm-beads-e2e-deadbeef-other/x/.beads/dolt'],
  ])
  const deps = {
    listDoltServerPids: () => [...cwds.keys()],
    cwdOf: (pid: number) => cwds.get(pid) ?? null,
  }

  it('keeps only the servers rooted inside the scan root', () => {
    expect(doltServersUnder('/var/tmp/pm-beads-e2e-deadbeef', deps)).toEqual([
      { pid: 40328, cwd: cwds.get(40328) },
    ])
  })

  it('does not treat a sibling directory with the same prefix as inside', () => {
    const inside = doltServersUnder('/var/tmp/pm-beads-e2e-deadbeef', deps)
    expect(inside.map((server) => server.pid)).not.toContain(51236)
  })

  it('skips processes whose cwd cannot be read', () => {
    expect(
      doltServersUnder('/var/tmp/pm-beads-e2e-deadbeef', {
        listDoltServerPids: () => [777],
        cwdOf: () => null,
      }),
    ).toEqual([])
  })
})
