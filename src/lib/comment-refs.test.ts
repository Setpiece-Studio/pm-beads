// ABOUTME: Unit tests for the comment-reference tokenizer — the `comment:<id>` token, the
// ABOUTME: `#comment-<id>` deep link, code exclusion, dedup, and the anchor/hash round trip.

import { describe, expect, it } from 'vitest'
import {
  commentAnchorId,
  commentIdFromHash,
  findCommentRefs,
} from './comment-refs'

const ID = '019ebd2c-6ab6-7b2b-8b84-bafa31a3101b'
const OTHER = '019ebd2c-6ab6-7b2b-8b84-000000000002'

describe('findCommentRefs', () => {
  it('finds a bare comment: token and leaves its bead unknown', () => {
    expect(findCommentRefs(`Answering comment:${ID} now.`)).toEqual([
      { commentId: ID },
    ])
  })

  it('reads the bead out of a pm-beads deep link', () => {
    expect(
      findCommentRefs(
        `See http://localhost:8345/issues/pm-beads-6hr#comment-${ID}`,
      ),
    ).toEqual([{ commentId: ID, issueId: 'pm-beads-6hr' }])
  })

  it('keeps the bead when the link carries a project query', () => {
    expect(
      findCommentRefs(
        `http://localhost:8345/issues/pm-beads-6hr?project=/tmp/p#comment-${ID}`,
      ),
    ).toEqual([{ commentId: ID, issueId: 'pm-beads-6hr' }])
  })

  it('reads an epic link the same way', () => {
    expect(
      findCommentRefs(`https://x.test/projects/pm-beads-6wt#comment-${ID}`),
    ).toEqual([{ commentId: ID, issueId: 'pm-beads-6wt' }])
  })

  it('lowercases the ids it reports', () => {
    expect(findCommentRefs(`comment:${ID.toUpperCase()}`)).toEqual([
      { commentId: ID },
    ])
  })

  it('reports each comment once, in source order', () => {
    const body = `First comment:${ID}, then comment:${OTHER}, then comment:${ID} again.`
    expect(findCommentRefs(body)).toEqual([
      { commentId: ID },
      { commentId: OTHER },
    ])
  })

  it('prefers the reference that names the bead when one comment is written both ways', () => {
    const body = `comment:${ID} — full link: https://x.test/issues/pm-beads-6hr#comment-${ID}`
    expect(findCommentRefs(body)).toEqual([
      { commentId: ID, issueId: 'pm-beads-6hr' },
    ])
  })

  it('ignores references inside inline code and fenced blocks', () => {
    const body = [
      'Run `bd comment:x` — no.',
      '',
      '```',
      `comment:${ID}`,
      '```',
    ].join('\n')
    expect(findCommentRefs(body)).toEqual([])
  })

  it('does not read prose as a reference', () => {
    expect(findCommentRefs('comment: see below')).toEqual([])
    expect(findCommentRefs('comment:1')).toEqual([])
    expect(findCommentRefs(`no-comment:${ID}`)).toEqual([])
  })

  it('finds nothing in a body that references none', () => {
    expect(findCommentRefs('Just a plain reply.')).toEqual([])
  })
})

describe('commentAnchorId / commentIdFromHash', () => {
  it('round-trips an id through the anchor form', () => {
    expect(commentAnchorId(ID)).toBe(`comment-${ID}`)
    expect(commentIdFromHash(`#${commentAnchorId(ID)}`)).toBe(ID)
  })

  it('accepts a hash written without its leading #', () => {
    expect(commentIdFromHash(`comment-${ID}`)).toBe(ID)
  })

  it('ignores any other hash', () => {
    expect(commentIdFromHash('#activity')).toBeUndefined()
    expect(commentIdFromHash('#comment-')).toBeUndefined()
    expect(commentIdFromHash('')).toBeUndefined()
    expect(commentIdFromHash(undefined)).toBeUndefined()
  })
})
