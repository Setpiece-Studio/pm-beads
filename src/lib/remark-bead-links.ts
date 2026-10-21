// ABOUTME: Remark plugin turning bead references in a markdown tree into marked link nodes,
// ABOUTME: which the Markdown component renders as BeadChips instead of plain anchors.

import { findBeadRefsInText, parseBeadUrl } from './bead-links'

/** The `data-*` attribute the Markdown component's anchor renderer keys on. */
export const BEAD_ID_ATTRIBUTE = 'data-bead-id'
/** Set only when the reference itself proved the bead is an epic (a `/projects/` url). */
export const BEAD_EPIC_ATTRIBUTE = 'data-bead-epic'

export interface RemarkBeadLinksOptions {
  /** The project's bead-id prefix. Null (no lookup in scope) still linkifies urls, which name
   * their bead outright, but leaves bare ids and `[[id]]` as plain text. */
  prefix: string | null
}

/**
 * The mdast shape this plugin touches. Declared locally rather than pulled from `@types/mdast`
 * so the markdown pipeline stays a runtime dependency and not a typing one.
 */
interface MdNode {
  type: string
  value?: string
  url?: string
  children?: MdNode[]
  data?: { hProperties?: Record<string, string> }
}

/** Containers whose contents are code or already a link — nothing inside them is a reference. */
const OPAQUE = new Set(['code', 'inlineCode', 'html', 'definition', 'link'])

export function remarkBeadLinks(options: RemarkBeadLinksOptions) {
  // `unknown` rather than MdNode: unified types the transformer's tree as its own `Node`, and
  // the narrower local shape would make the plugin unassignable to `Pluggable`.
  return (tree: unknown): void => {
    transform(tree as MdNode, options.prefix)
  }
}

function transform(node: MdNode, prefix: string | null): void {
  const children = node.children
  if (children === undefined) return

  const replaced: MdNode[] = []
  for (const child of children) {
    if (child.type === 'text') {
      replaced.push(...splitText(child, prefix))
      continue
    }
    if (child.type === 'link') {
      replaced.push(linkNode(child))
      continue
    }
    if (!OPAQUE.has(child.type)) transform(child, prefix)
    replaced.push(child)
  }
  node.children = replaced
}

/** A link node becomes a chip only when it IS the url — an autolink or a GFM literal. A link
 * with its own label (`[the cache bead](…/issues/x)`) keeps the words the author chose. */
function linkNode(node: MdNode): MdNode {
  const only = node.children?.length === 1 ? node.children[0] : undefined
  if (only?.type !== 'text' || only.value !== node.url) return node
  const bead = parseBeadUrl(node.url ?? '')
  return bead === null ? node : beadLink(bead.id, bead.epic)
}

function splitText(node: MdNode, prefix: string | null): MdNode[] {
  const value = node.value ?? ''
  const refs = findBeadRefsInText(value, prefix)
  if (refs.length === 0) return [node]

  const out: MdNode[] = []
  let cursor = 0
  for (const ref of refs) {
    if (ref.start > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, ref.start) })
    }
    out.push(beadLink(ref.id, ref.epic))
    cursor = ref.end
  }
  if (cursor < value.length) {
    out.push({ type: 'text', value: value.slice(cursor) })
  }
  return out
}

/** A real link node, so the href survives for middle-click and for anyone reading the markup;
 * the `data-` attributes are what tell the renderer to draw a chip instead of an anchor. */
function beadLink(id: string, epic: boolean): MdNode {
  const hProperties: Record<string, string> = { [BEAD_ID_ATTRIBUTE]: id }
  if (epic) hProperties[BEAD_EPIC_ATTRIBUTE] = 'true'
  return {
    type: 'link',
    url: `${epic ? '/projects/' : '/issues/'}${id}`,
    data: { hProperties },
    children: [{ type: 'text', value: id }],
  }
}
