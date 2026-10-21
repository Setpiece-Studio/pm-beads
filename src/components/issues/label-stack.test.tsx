// ABOUTME: Component tests for LabelStack — collapsed overlap count, the +N overflow chip,
// ABOUTME: expansion on hover and keyboard focus, and the full label list for screen readers.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LABEL_STACK_VISIBLE, LabelStack } from './label-stack'

afterEach(cleanup)

function stack(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-label-stack]')
  if (!element) throw new Error('no label stack rendered')
  return element as HTMLElement
}

function items(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('[data-label-stack-item]')]
}

describe('LabelStack', () => {
  it('renders nothing when there are no labels', () => {
    const { container } = render(<LabelStack labels={[]} />)
    expect(container.querySelector('[data-label-stack]')).toBeNull()
  })

  it('stacks at most the visible count and names only the first pill', () => {
    const { container } = render(
      <LabelStack labels={['frontend', 'backend', 'infra', 'docs']} />,
    )
    expect(items(container)).toHaveLength(LABEL_STACK_VISIBLE)
    // The leading pill carries its name; the ones behind it peek out as color dots only.
    expect(screen.getByText('frontend')).toBeTruthy()
    expect(screen.queryByText('backend')).toBeNull()
    expect(screen.queryByText('infra')).toBeNull()
  })

  it('overlaps every pill after the first with a negative margin', () => {
    const { container } = render(
      <LabelStack labels={['frontend', 'backend', 'infra']} />,
    )
    const [first, ...rest] = items(container)
    expect(first.className).not.toMatch(/-ml-/)
    for (const item of rest) expect(item.className).toMatch(/-ml-/)
  })

  it('counts the labels beyond the stack in a +N chip', () => {
    const { unmount } = render(
      <LabelStack labels={['a', 'b', 'c', 'd', 'e']} />,
    )
    expect(screen.getByText('+2')).toBeTruthy()
    unmount()
    render(<LabelStack labels={['a', 'b', 'c']} />)
    expect(screen.queryByText(/^\+\d+$/)).toBeNull()
  })

  it('expands to every pill on hover and collapses again on leave', () => {
    const { container } = render(
      <LabelStack labels={['frontend', 'backend', 'infra', 'docs']} />,
    )
    const element = stack(container)
    expect(element.dataset.expanded).toBe('false')

    fireEvent.mouseEnter(element)
    expect(element.dataset.expanded).toBe('true')
    expect(items(container)).toHaveLength(4)
    for (const label of ['frontend', 'backend', 'infra', 'docs']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(screen.queryByText('+1')).toBeNull()

    fireEvent.mouseLeave(element)
    expect(element.dataset.expanded).toBe('false')
    expect(items(container)).toHaveLength(LABEL_STACK_VISIBLE)
  })

  it('expands on keyboard focus and collapses on blur', () => {
    const { container } = render(
      <LabelStack labels={['frontend', 'backend', 'infra', 'docs']} />,
    )
    const element = stack(container)
    expect(element.tabIndex).toBe(0)

    fireEvent.focus(element)
    expect(element.dataset.expanded).toBe('true')
    expect(screen.getByText('docs')).toBeTruthy()

    fireEvent.blur(element)
    expect(element.dataset.expanded).toBe('false')
  })

  it('names every label for assistive tech even while collapsed', () => {
    const labels = ['frontend', 'backend', 'infra', 'docs']
    const { container } = render(<LabelStack labels={labels} />)
    const element = stack(container)
    expect(element.getAttribute('aria-label')).toBe(
      `Labels: ${labels.join(', ')}`,
    )
    expect(element.getAttribute('title')).toBe(labels.join(', '))
  })
})
