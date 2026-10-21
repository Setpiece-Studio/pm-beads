// ABOUTME: Tests @agent query detection, canonical insertion, alias filtering, and keyboard use.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { MentionProvider } from './mention-context'
import {
  activeMentionQuery,
  insertMention,
  MentionTextarea,
} from './mention-textarea'

afterEach(cleanup)

describe('mention text editing', () => {
  it('finds only the @token immediately before the caret', () => {
    expect(activeMentionQuery('hello @dar', 10)).toEqual({
      start: 6,
      end: 10,
      query: 'dar',
    })
    expect(activeMentionQuery('email@example.com', 17)).toBeNull()
    expect(activeMentionQuery('hello @dar later', 16)).toBeNull()
  })

  it('replaces the query with the canonical persona key', () => {
    expect(
      insertMention(
        'hello @Dar',
        { start: 6, end: 10, query: 'Dar' },
        'data-engineer',
      ),
    ).toEqual({ value: 'hello @data-engineer ', caret: 21 })
  })
})

describe('MentionTextarea', () => {
  it('finds a persona by alias and inserts its key with Enter', () => {
    function Harness() {
      const [value, setValue] = useState('')
      return (
        <MentionTextarea
          aria-label="Comment"
          value={value}
          onChange={setValue}
        />
      )
    }
    render(
      <MentionProvider
        currentUser={{ key: 'ben', aliases: ['Ben'] }}
        personas={{
          'data-engineer': { tmux: 'daryl', aliases: ['Daryl'] },
          coordinator: { tmux: 'coord' },
        }}
      >
        <Harness />
      </MentionProvider>,
    )
    const textbox = screen.getByRole('textbox', { name: 'Comment' })
    fireEvent.change(textbox, {
      target: { value: '@Dar', selectionStart: 4 },
    })
    expect(screen.getByRole('option').textContent).toContain('@data-engineer')
    fireEvent.keyDown(textbox, { key: 'Enter' })
    expect((textbox as HTMLTextAreaElement).value).toBe('@data-engineer ')
  })

  it('offers the current user and mention-only agents without tmux', () => {
    function Harness() {
      const [value, setValue] = useState('')
      return (
        <MentionTextarea
          aria-label="Comment"
          value={value}
          onChange={setValue}
        />
      )
    }
    render(
      <MentionProvider
        currentUser={{ key: 'ben', aliases: ['Ben Harper'] }}
        personas={{ cpo: { aliases: ['CPO'] }, ben: { aliases: ['Ben'] } }}
      >
        <Harness />
      </MentionProvider>,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), {
      target: { value: '@', selectionStart: 1 },
    })
    const options = screen
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toHaveLength(2)
    expect(options[0]).toContain('@benYou')
    expect(options[1]).toContain('@cpo')
  })
})
