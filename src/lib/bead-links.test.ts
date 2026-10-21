// ABOUTME: Unit tests for the bead-reference tokenizer — prefix boundaries, dotted legacy ids,
// ABOUTME: explicit [[id]] syntax, pm-beads urls, and the code-span/fence exclusions.

import { describe, expect, it } from 'vitest'
import { findBeadRefs, findBeadRefsInText, parseBeadUrl } from './bead-links'

const PREFIX = 'pm-beads-'

function ids(text: string, prefix: string | null = PREFIX): string[] {
  return findBeadRefs(text, prefix).map((ref) => ref.id)
}

describe('findBeadRefs — bare ids', () => {
  it('finds a bare id of the project prefix', () => {
    expect(ids('see pm-beads-gnj for details')).toEqual(['pm-beads-gnj'])
  })

  it('takes the longest id at a boundary, so -10 is never read as -1', () => {
    expect(ids('pm-beads-10 and pm-beads-1')).toEqual([
      'pm-beads-10',
      'pm-beads-1',
    ])
  })

  it('does not match an id glued to a preceding word character or hyphen', () => {
    expect(ids('xpm-beads-1')).toEqual([])
    expect(ids('old-pm-beads-1')).toEqual([])
  })

  it('matches dotted legacy ids whole', () => {
    expect(ids('pm-beads-4.2 is a child')).toEqual(['pm-beads-4.2'])
  })

  it('lowercases the id it reports', () => {
    expect(ids('PM-Beads-GNJ')).toEqual(['pm-beads-gnj'])
  })

  it('finds nothing when the prefix is unknown', () => {
    expect(ids('see pm-beads-gnj', null)).toEqual([])
  })

  it('finds nothing for a different project prefix', () => {
    expect(ids('see other-1', PREFIX)).toEqual([])
  })

  it('reports the source span it covers', () => {
    const [ref] = findBeadRefs('see pm-beads-1 now', PREFIX)
    expect(ref).toMatchObject({ kind: 'bare', start: 4, end: 14 })
  })
})

describe('findBeadRefs — code', () => {
  it('ignores an id inside an inline code span', () => {
    expect(ids('run `bd show pm-beads-1` first')).toEqual([])
  })

  it('ignores an id inside a fenced block', () => {
    expect(ids(['```sh', 'bd show pm-beads-1', '```'].join('\n'))).toEqual([])
  })

  it('ignores an id inside a tilde-fenced block', () => {
    expect(ids(['~~~', 'pm-beads-1', '~~~'].join('\n'))).toEqual([])
  })

  it('still finds ids outside the code', () => {
    expect(ids('pm-beads-1 then `pm-beads-2` then pm-beads-3')).toEqual([
      'pm-beads-1',
      'pm-beads-3',
    ])
  })

  it('leaves a lone unmatched backtick harmless', () => {
    expect(ids('a ` b pm-beads-1')).toEqual(['pm-beads-1'])
  })

  it('honours multi-backtick code span delimiters', () => {
    expect(ids('``a ` pm-beads-1`` and pm-beads-2')).toEqual(['pm-beads-2'])
  })
})

describe('findBeadRefs — explicit [[id]]', () => {
  it('finds an explicit reference and covers its brackets', () => {
    const [ref] = findBeadRefs('as in [[pm-beads-1]] here', PREFIX)
    expect(ref).toMatchObject({
      id: 'pm-beads-1',
      kind: 'wiki',
      start: 6,
      end: 20,
    })
  })

  it('reports the explicit reference once, not also as a bare id', () => {
    expect(ids('[[pm-beads-1]]')).toEqual(['pm-beads-1'])
  })

  it('needs the project prefix — an unknown prefix links nothing', () => {
    expect(ids('[[pm-beads-1]]', null)).toEqual([])
    expect(ids('[[other-1]]')).toEqual([])
  })
})

describe('findBeadRefs — urls', () => {
  it('finds an issue url on any host', () => {
    const [ref] = findBeadRefs(
      'http://localhost:8345/issues/pm-beads-1',
      PREFIX,
    )
    expect(ref).toMatchObject({ id: 'pm-beads-1', kind: 'url', epic: false })
  })

  it('finds a project url and marks it an epic', () => {
    const [ref] = findBeadRefs(
      'https://example.test/projects/pm-beads-6wt',
      null,
    )
    expect(ref).toMatchObject({ id: 'pm-beads-6wt', kind: 'url', epic: true })
  })

  it('swallows a ?project= query so it does not render as trailing text', () => {
    const text =
      'see http://localhost:8345/issues/pm-beads-1?project=/tmp/x done'
    const [ref] = findBeadRefs(text, PREFIX)
    expect(ref.id).toBe('pm-beads-1')
    expect(text.slice(ref.start, ref.end)).toBe(
      'http://localhost:8345/issues/pm-beads-1?project=/tmp/x',
    )
  })

  it('swallows a #comment- fragment so the deep link renders as one chip', () => {
    const text =
      'see http://localhost:8345/issues/pm-beads-1#comment-019ebd2c-6ab6 done'
    const [ref] = findBeadRefs(text, PREFIX)
    expect(ref.id).toBe('pm-beads-1')
    expect(text.slice(ref.start, ref.end)).toBe(
      'http://localhost:8345/issues/pm-beads-1#comment-019ebd2c-6ab6',
    )
  })

  it('does not need the project prefix — the url is explicit', () => {
    expect(ids('http://localhost:8345/issues/other-1', PREFIX)).toEqual([
      'other-1',
    ])
  })

  it('ignores a url inside a code span', () => {
    expect(ids('`http://localhost:8345/issues/pm-beads-1`')).toEqual([])
  })

  it('leaves an unrelated url alone', () => {
    expect(ids('https://github.com/pm-beads/pm-beads/pull/9')).toEqual([])
  })
})

describe('parseBeadUrl', () => {
  it('reads an issue url', () => {
    expect(parseBeadUrl('http://localhost:8345/issues/pm-beads-1')).toEqual({
      id: 'pm-beads-1',
      epic: false,
    })
  })

  it('reads a project url', () => {
    expect(
      parseBeadUrl('https://host/projects/pm-beads-6wt?project=/a'),
    ).toEqual({ id: 'pm-beads-6wt', epic: true })
  })

  it('rejects anything else', () => {
    expect(parseBeadUrl('https://github.com/x/y/pull/1')).toBeNull()
    expect(parseBeadUrl('not a url')).toBeNull()
  })
})

describe('findBeadRefsInText', () => {
  it('scans a plain string with no code handling — the ast supplies that', () => {
    expect(
      findBeadRefsInText('`pm-beads-1`', PREFIX).map((ref) => ref.id),
    ).toEqual(['pm-beads-1'])
  })

  it('returns references in source order', () => {
    expect(
      findBeadRefsInText(
        'pm-beads-3 [[pm-beads-2]] http://h/issues/pm-beads-1',
        PREFIX,
      ).map((ref) => ref.id),
    ).toEqual(['pm-beads-3', 'pm-beads-2', 'pm-beads-1'])
  })
})
