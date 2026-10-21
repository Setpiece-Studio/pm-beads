// ABOUTME: Rendering tests for the read-only Markdown component — element rendering, GFM tables/task
// ABOUTME: lists, empty/whitespace guards, and the no-raw-HTML safety guarantee.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Markdown } from '../markdown'

afterEach(cleanup)

describe('Markdown', () => {
  it('renders a heading, bold text, an unordered list, and a fenced code block', () => {
    const { container } = render(
      <Markdown>
        {[
          '# Title',
          '',
          'This is **bold** text.',
          '',
          '- one',
          '- two',
          '',
          '```js',
          'const x = 1',
          '```',
        ].join('\n')}
      </Markdown>,
    )

    expect(
      screen.getByRole('heading', { level: 1, name: 'Title' }),
    ).toBeDefined()

    const strong = container.querySelector('strong')
    expect(strong?.textContent).toBe('bold')

    const listItems = container.querySelectorAll('ul > li')
    expect(listItems).toHaveLength(2)
    expect(listItems[0].textContent).toBe('one')
    expect(listItems[1].textContent).toBe('two')

    const code = container.querySelector('pre > code')
    expect(code?.textContent).toContain('const x = 1')
  })

  it('renders a markdown table and a task list via remark-gfm', () => {
    const { container } = render(
      <Markdown>
        {[
          '| Name | Value |',
          '| --- | --- |',
          '| a | 1 |',
          '| b | 2 |',
          '',
          '- [x] done',
          '- [ ] todo',
        ].join('\n')}
      </Markdown>,
    )

    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(container.querySelectorAll('thead th')).toHaveLength(2)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)

    const checkboxes = container.querySelectorAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false)
  })

  it('renders nothing for an empty string', () => {
    const { container } = render(<Markdown>{''}</Markdown>)
    expect(container.querySelector('[data-slot="markdown"]')).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for undefined input', () => {
    const { container } = render(<Markdown>{undefined}</Markdown>)
    expect(container.querySelector('[data-slot="markdown"]')).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for whitespace-only input', () => {
    const space = render(<Markdown> </Markdown>)
    expect(space.container.querySelector('[data-slot="markdown"]')).toBeNull()
    expect(space.container.innerHTML).toBe('')

    cleanup()

    const newline = render(<Markdown>{'\n'}</Markdown>)
    expect(newline.container.querySelector('[data-slot="markdown"]')).toBeNull()
    expect(newline.container.innerHTML).toBe('')
  })

  it('does not render raw HTML as live elements', () => {
    const { container } = render(
      <Markdown>
        {'<script>alert(1)</script>\n\n<div id="evil">x</div>'}
      </Markdown>,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('#evil')).toBeNull()
    expect(container.querySelector('div[data-slot="markdown"]')).not.toBeNull()
    // The raw HTML is rendered as escaped text, not parsed into nodes.
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })
})
