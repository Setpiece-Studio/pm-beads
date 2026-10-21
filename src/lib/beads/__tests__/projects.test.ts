// ABOUTME: Unit tests for the beads project guard and on-disk project discovery — the
// ABOUTME: Dolt-backend predicate, scan-dir parsing, depth-limited scanning, realpath dedupe.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertBeadsProjectDir,
  bdOptionsFor,
  discoverProjects,
  isDoltBeadsProject,
  parseScanDirs,
} from '../projects'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pm-beads-projects-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** The on-disk shapes a .beads directory can take, as bd writes them:
 * `bd init` (embedded), `bd init --server`, a git-worktree redirect, and the
 * pre-Dolt (SQLite + JSONL) layout that bd 1.x refuses to open. */
type BeadsLayout =
  | 'embedded'
  | 'server'
  | 'redirect'
  | 'legacy'
  | 'no-metadata'
  | 'unparsable-metadata'
  | 'dolt-metadata-without-database'

function makeBeadsDir(dir: string, layout: BeadsLayout): string {
  const beads = join(dir, '.beads')
  mkdirSync(beads, { recursive: true })
  const metadata = join(beads, 'metadata.json')
  const dolt = {
    database: 'dolt',
    backend: 'dolt',
    dolt_database: 'fixture',
    project_id: 'fixture',
  }
  switch (layout) {
    case 'embedded':
      writeFileSync(
        metadata,
        JSON.stringify({ ...dolt, dolt_mode: 'embedded' }, null, 2),
      )
      mkdirSync(join(beads, 'embeddeddolt'))
      break
    case 'server':
      writeFileSync(
        metadata,
        JSON.stringify({ ...dolt, dolt_mode: 'server' }, null, 2),
      )
      mkdirSync(join(beads, 'dolt'))
      break
    case 'redirect':
      writeFileSync(
        metadata,
        JSON.stringify({ ...dolt, dolt_mode: 'embedded' }, null, 2),
      )
      writeFileSync(join(beads, 'redirect'), '../../.beads')
      break
    case 'legacy':
      writeFileSync(
        metadata,
        JSON.stringify(
          { database: 'beads.db', jsonl_export: 'issues.jsonl' },
          null,
          2,
        ),
      )
      writeFileSync(join(beads, 'issues.jsonl'), '')
      break
    case 'no-metadata':
      writeFileSync(join(beads, 'config.yaml'), '# no metadata.json here\n')
      break
    case 'unparsable-metadata':
      writeFileSync(metadata, '{ this is not json')
      break
    case 'dolt-metadata-without-database':
      writeFileSync(
        metadata,
        JSON.stringify({ ...dolt, dolt_mode: 'embedded' }, null, 2),
      )
      break
  }
  return dir
}

/** A discoverable project under the temp root. Defaults to the embedded-dolt layout,
 * which is what `bd init` produces. */
function makeProject(
  segments: string[],
  layout: BeadsLayout = 'embedded',
): string {
  return makeBeadsDir(join(root, ...segments), layout)
}

describe('isDoltBeadsProject', () => {
  it('accepts an embedded-dolt project (.beads/embeddeddolt)', () => {
    expect(isDoltBeadsProject(makeProject(['embedded'], 'embedded'))).toBe(true)
  })

  it('accepts a server-mode project (.beads/dolt)', () => {
    expect(isDoltBeadsProject(makeProject(['server'], 'server'))).toBe(true)
  })

  it('accepts a worktree redirect (.beads/redirect)', () => {
    expect(isDoltBeadsProject(makeProject(['redirected'], 'redirect'))).toBe(
      true,
    )
  })

  it('rejects a legacy pre-Dolt workspace (sqlite metadata, no dolt dir)', () => {
    expect(isDoltBeadsProject(makeProject(['legacy'], 'legacy'))).toBe(false)
  })

  it('rejects a .beads directory with no metadata.json', () => {
    expect(isDoltBeadsProject(makeProject(['bare'], 'no-metadata'))).toBe(false)
  })

  it('rejects a .beads directory whose metadata.json does not parse', () => {
    expect(
      isDoltBeadsProject(makeProject(['broken'], 'unparsable-metadata')),
    ).toBe(false)
  })

  it('rejects dolt metadata with no database on disk', () => {
    expect(
      isDoltBeadsProject(
        makeProject(['empty'], 'dolt-metadata-without-database'),
      ),
    ).toBe(false)
  })

  it('rejects a directory with no .beads at all', () => {
    const dir = join(root, 'plain')
    mkdirSync(dir)
    expect(isDoltBeadsProject(dir)).toBe(false)
  })

  it('rejects a nonexistent directory', () => {
    expect(isDoltBeadsProject(join(root, 'missing'))).toBe(false)
  })
})

describe('assertBeadsProjectDir', () => {
  it('accepts an embedded-dolt project', () => {
    const dir = makeProject(['good'], 'embedded')
    expect(() => assertBeadsProjectDir(dir)).not.toThrow()
  })

  it('accepts a server-mode project', () => {
    const dir = makeProject(['good-server'], 'server')
    expect(() => assertBeadsProjectDir(dir)).not.toThrow()
  })

  it('rejects a directory without .beads', () => {
    const dir = join(root, 'plain')
    mkdirSync(dir)
    expect(() => assertBeadsProjectDir(dir)).toThrow(
      /not a dolt-backed beads project/i,
    )
  })

  it('rejects a nonexistent directory', () => {
    expect(() => assertBeadsProjectDir(join(root, 'missing'))).toThrow(
      /not a dolt-backed beads project/i,
    )
  })

  it('rejects when .beads is a file, not a directory', () => {
    const dir = join(root, 'filey')
    mkdirSync(dir)
    writeFileSync(join(dir, '.beads'), 'nope')
    expect(() => assertBeadsProjectDir(dir)).toThrow(
      /not a dolt-backed beads project/i,
    )
  })

  it('names the offending path and the legacy backend in the message', () => {
    const dir = makeProject(['legacy'], 'legacy')
    expect(() => assertBeadsProjectDir(dir)).toThrow(dir)
    expect(() => assertBeadsProjectDir(dir)).toThrow(/legacy/i)
  })

  it('rejects dolt metadata with no database on disk', () => {
    const dir = makeProject(['empty'], 'dolt-metadata-without-database')
    expect(() => assertBeadsProjectDir(dir)).toThrow(
      /not a dolt-backed beads project/i,
    )
  })
})

describe('bdOptionsFor', () => {
  it('returns empty options when no projectDir is given', () => {
    expect(bdOptionsFor(undefined)).toEqual({})
  })

  it('returns cwd for a valid beads project dir', () => {
    const dir = makeProject(['valid'])
    expect(bdOptionsFor(dir)).toEqual({ cwd: dir })
  })

  it('throws for a dir that is not a beads project', () => {
    const dir = join(root, 'nope')
    mkdirSync(dir)
    expect(() => bdOptionsFor(dir)).toThrow(/not a dolt-backed beads project/i)
  })

  it('throws for a legacy pre-Dolt beads project', () => {
    const dir = makeProject(['legacy'], 'legacy')
    expect(() => bdOptionsFor(dir)).toThrow(/not a dolt-backed beads project/i)
  })
})

describe('parseScanDirs', () => {
  it('defaults to ~/Developer:~/developer expanded against home', () => {
    expect(parseScanDirs(undefined, '/home/zo')).toEqual([
      '/home/zo/Developer',
      '/home/zo/developer',
    ])
  })

  it('splits on colons, trims, and drops empty entries', () => {
    expect(parseScanDirs('/a : /b ::/c', '/home/zo')).toEqual([
      '/a',
      '/b',
      '/c',
    ])
  })

  it('expands a leading ~ in each entry', () => {
    expect(parseScanDirs('~/code:~/work/repos', '/home/zo')).toEqual([
      '/home/zo/code',
      '/home/zo/work/repos',
    ])
  })
})

describe('discoverProjects', () => {
  it('finds projects at depth 1 and 2 under scan roots', () => {
    const dflt = makeProject(['dflt'])
    makeProject(['scan', 'alpha'])
    makeProject(['scan', 'nested', 'beta'])
    const projects = discoverProjects([join(root, 'scan')], dflt)
    expect(projects.map((p) => p.name)).toEqual(['dflt', 'alpha', 'beta'])
  })

  it('does not descend past depth 2', () => {
    const dflt = makeProject(['dflt'])
    makeProject(['scan', 'a', 'b', 'toodeep'])
    const projects = discoverProjects([join(root, 'scan')], dflt)
    expect(projects.map((p) => p.name)).toEqual(['dflt'])
  })

  it('skips node_modules and hidden directories', () => {
    const dflt = makeProject(['dflt'])
    makeProject(['scan', 'node_modules', 'sneaky'])
    makeProject(['scan', '.hidden', 'ghost'])
    makeProject(['scan', 'visible'])
    const projects = discoverProjects([join(root, 'scan')], dflt)
    expect(projects.map((p) => p.name)).toEqual(['dflt', 'visible'])
  })

  it('always includes the default project first, marked as default', () => {
    const dflt = makeProject(['elsewhere', 'home-project'])
    makeProject(['scan', 'alpha'])
    const projects = discoverProjects([join(root, 'scan')], dflt)
    expect(projects[0]).toMatchObject({ name: 'home-project', isDefault: true })
    expect(projects[1]).toMatchObject({ name: 'alpha', isDefault: false })
  })

  it('dedupes the default when it is also discovered in a scan root', () => {
    const dflt = makeProject(['scan', 'alpha'])
    makeProject(['scan', 'beta'])
    const projects = discoverProjects([join(root, 'scan')], dflt)
    expect(projects.map((p) => p.name)).toEqual(['alpha', 'beta'])
    expect(projects[0].isDefault).toBe(true)
  })

  it('dedupes scan roots that resolve to the same realpath via symlink', () => {
    const dflt = makeProject(['dflt'])
    makeProject(['scan', 'alpha'])
    const link = join(root, 'scan-link')
    symlinkSync(join(root, 'scan'), link)
    const projects = discoverProjects([join(root, 'scan'), link], dflt)
    expect(projects.filter((p) => p.name === 'alpha')).toHaveLength(1)
  })

  it('ignores scan roots that do not exist', () => {
    const dflt = makeProject(['dflt'])
    const projects = discoverProjects([join(root, 'no-such-dir')], dflt)
    expect(projects.map((p) => p.name)).toEqual(['dflt'])
  })

  it('sorts discovered projects by name after the default', () => {
    const dflt = makeProject(['dflt'])
    makeProject(['scan', 'zeta'])
    makeProject(['scan', 'alpha'])
    const projects = discoverProjects([join(root, 'scan')], dflt)
    expect(projects.map((p) => p.name)).toEqual(['dflt', 'alpha', 'zeta'])
  })

  it('lists both embedded and server-mode dolt projects', () => {
    const dflt = makeProject(['dflt'])
    makeProject(['scan', 'embedded-one'], 'embedded')
    makeProject(['scan', 'server-one'], 'server')
    makeProject(['scan', 'redirect-one'], 'redirect')
    const projects = discoverProjects([join(root, 'scan')], dflt)
    expect(projects.map((p) => p.name)).toEqual([
      'dflt',
      'embedded-one',
      'redirect-one',
      'server-one',
    ])
  })

  it('skips .beads directories that are not Dolt-backed', () => {
    const dflt = makeProject(['dflt'])
    makeProject(['scan', 'legacy-one'], 'legacy')
    makeProject(['scan', 'bare-one'], 'no-metadata')
    makeProject(['scan', 'broken-one'], 'unparsable-metadata')
    makeProject(['scan', 'empty-one'], 'dolt-metadata-without-database')
    makeProject(['scan', 'good-one'], 'embedded')
    const projects = discoverProjects([join(root, 'scan')], dflt)
    expect(projects.map((p) => p.name)).toEqual(['dflt', 'good-one'])
  })

  it('still lists the default project even when it is not Dolt-backed', () => {
    const dflt = makeProject(['legacy-default'], 'legacy')
    const projects = discoverProjects([join(root, 'scan')], dflt)
    expect(projects.map((p) => p.name)).toEqual(['legacy-default'])
  })
})
